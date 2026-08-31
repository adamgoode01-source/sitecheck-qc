import ARKit
import SceneKit
import UIKit

enum PointConfidence: String {
    case high
    case medium
    case low
}

struct MeasuredPoint {
    let position: SIMD3<Float>
    let confidence: PointConfidence
}

struct CapturePhase {
    let id: String
    let title: String
    let instruction: String
    let minPoints: Int
    let maxPoints: Int?
    let optional: Bool
}

struct CaptureOutcome {
    var cancelled: Bool
    /// Points keyed by phase id. Skipped phases are absent, never empty.
    var phases: [String: [MeasuredPoint]]
    var cameraPosition: SIMD3<Float>?
    var photoBase64: String?
    var usedSceneDepth: Bool
    var warnings: [String]
}

/**
 The AR capture screen.

 Walks the requested phases in order — "mark each stud", or "mark the floor,
 then the datum, then each box". Each tap is raycast into the scene. Where the
 raycast lands determines the confidence we report:

   - a reconstructed mesh (LiDAR)            -> high
   - the geometry of a detected plane        -> medium
   - an estimated plane                      -> low

 That last case is ARKit guessing at a surface from feature points, and it can
 be out by an inch or more. We still place the point, because refusing mid-
 inspection is unhelpful, but it is flagged all the way through to the report.
 */
final class ARMeasureViewController: UIViewController, ARSessionDelegate {

    // MARK: - Configuration

    private let titleText: String
    private let phases: [CapturePhase]

    var onFinish: ((CaptureOutcome) -> Void)?

    // MARK: - State

    private var phaseIndex = 0
    private var collected: [String: [MeasuredPoint]] = [:]
    private var current: [MeasuredPoint] = []
    private var markerNodes: [SCNNode] = []
    private var warnings: [String] = []
    private var sawLimitedTracking = false

    private lazy var sceneView = ARSCNView(frame: .zero)
    private let instructionLabel = UILabel()
    private let counterLabel = UILabel()
    private let undoButton = UIButton(type: .system)
    private let nextButton = UIButton(type: .system)
    private let skipButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)

    private var phase: CapturePhase { phases[min(phaseIndex, phases.count - 1)] }

    private var usesSceneDepth: Bool {
        ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
    }

    // MARK: - Init

    init(titleText: String, phases: [CapturePhase]) {
        self.titleText = titleText
        self.phases = phases
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used — this controller is created in code")
    }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        title = titleText
        setUpSceneView()
        setUpControls()
        updateChrome()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)

        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal, .vertical]
        configuration.environmentTexturing = .none

        if usesSceneDepth {
            configuration.sceneReconstruction = .mesh
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
                configuration.frameSemantics.insert(.sceneDepth)
            }
        }

        sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])

        // The screen must not sleep mid-capture: a worker lining up a shot on
        // a ladder should not have to re-authenticate and restart tracking.
        UIApplication.shared.isIdleTimerDisabled = true
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sceneView.session.pause()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    // MARK: - Set-up

    private func setUpSceneView() {
        sceneView.translatesAutoresizingMaskIntoConstraints = false
        sceneView.session.delegate = self
        sceneView.automaticallyUpdatesLighting = true
        view.addSubview(sceneView)

        NSLayoutConstraint.activate([
            sceneView.topAnchor.constraint(equalTo: view.topAnchor),
            sceneView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            sceneView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            sceneView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        sceneView.addGestureRecognizer(
            UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        )
    }

    private func setUpControls() {
        // Both labels sit on a near-opaque slab rather than translucent tint.
        // The camera feed behind them is bright concrete in full sun, and
        // white-on-55%-black disappears against it — the AR view is the one
        // screen the worker cannot navigate away from to read.
        instructionLabel.numberOfLines = 0
        instructionLabel.textColor = .white
        instructionLabel.font = .systemFont(ofSize: 18, weight: .bold)
        instructionLabel.textAlignment = .center
        instructionLabel.backgroundColor = UIColor.black.withAlphaComponent(0.85)
        instructionLabel.layer.cornerRadius = 10
        instructionLabel.layer.masksToBounds = true
        instructionLabel.layer.borderWidth = 1.5
        instructionLabel.layer.borderColor = UIColor.white.cgColor

        counterLabel.textColor = .white
        counterLabel.font = .monospacedDigitSystemFont(ofSize: 16, weight: .bold)
        counterLabel.textAlignment = .center
        counterLabel.backgroundColor = UIColor.black.withAlphaComponent(0.85)
        counterLabel.layer.cornerRadius = 8
        counterLabel.layer.masksToBounds = true

        styleButton(cancelButton, title: "Cancel")
        styleButton(undoButton, title: "Undo")
        styleButton(skipButton, title: "Skip")
        styleButton(nextButton, title: "Done", prominent: true)

        cancelButton.addTarget(self, action: #selector(handleCancel), for: .touchUpInside)
        undoButton.addTarget(self, action: #selector(handleUndo), for: .touchUpInside)
        skipButton.addTarget(self, action: #selector(handleSkip), for: .touchUpInside)
        nextButton.addTarget(self, action: #selector(handleNext), for: .touchUpInside)

        let controls = UIStackView(arrangedSubviews: [cancelButton, undoButton, skipButton, nextButton])
        controls.axis = .horizontal
        controls.distribution = .fillEqually
        controls.spacing = 8
        controls.translatesAutoresizingMaskIntoConstraints = false

        let stack = UIStackView(arrangedSubviews: [instructionLabel, counterLabel])
        stack.axis = .vertical
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(stack)
        view.addSubview(controls)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: guide.topAnchor, constant: 12),
            stack.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),

            controls.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -16),
            controls.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            controls.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            controls.heightAnchor.constraint(equalToConstant: 52)
        ])
    }

    private func styleButton(_ button: UIButton, title: String, prominent: Bool = false) {
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 17, weight: .bold)
        button.setTitleColor(prominent ? .black : .white, for: .normal)
        button.backgroundColor = prominent ? .white : UIColor.black.withAlphaComponent(0.85)
        button.layer.cornerRadius = 10
        button.layer.borderWidth = 1.5
        button.layer.borderColor = UIColor.white.cgColor
    }

    // MARK: - Interaction

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        if let maxPoints = phase.maxPoints, current.count >= maxPoints { return }

        let location = gesture.location(in: sceneView)
        guard let hit = raycast(from: location) else {
            flashInstruction("No surface there — move closer or aim at the face of the work.")
            return
        }

        current.append(hit)
        addMarker(at: hit)
        updateChrome()
    }

    /// Raycast in descending order of trustworthiness, recording which one hit.
    private func raycast(from screenPoint: CGPoint) -> MeasuredPoint? {
        let attempts: [(ARRaycastQuery.Target, PointConfidence)] = [
            (.existingPlaneGeometry, usesSceneDepth ? .high : .medium),
            (.estimatedPlane, .low)
        ]

        for (target, confidence) in attempts {
            guard let query = sceneView.raycastQuery(
                from: screenPoint,
                allowing: target,
                alignment: .any
            ) else { continue }

            guard let result = sceneView.session.raycast(query).first else { continue }

            let t = result.worldTransform.columns.3
            return MeasuredPoint(
                position: SIMD3<Float>(t.x, t.y, t.z),
                confidence: sawLimitedTracking ? .low : confidence
            )
        }

        return nil
    }

    private func addMarker(at point: MeasuredPoint) {
        let sphere = SCNSphere(radius: 0.006)
        sphere.firstMaterial?.diffuse.contents = colour(for: point.confidence)
        sphere.firstMaterial?.lightingModel = .constant

        let node = SCNNode(geometry: sphere)
        node.simdPosition = point.position
        sceneView.scene.rootNode.addChildNode(node)
        markerNodes.append(node)
    }

    private func colour(for confidence: PointConfidence) -> UIColor {
        switch confidence {
        case .high: return .systemGreen
        case .medium: return .systemYellow
        case .low: return .systemRed
        }
    }

    @objc private func handleUndo() {
        guard !current.isEmpty else { return }
        current.removeLast()
        markerNodes.popLast()?.removeFromParentNode()
        updateChrome()
    }

    @objc private func handleCancel() {
        onFinish?(CaptureOutcome(
            cancelled: true,
            phases: [:],
            cameraPosition: nil,
            photoBase64: nil,
            usedSceneDepth: usesSceneDepth,
            warnings: []
        ))
    }

    @objc private func handleSkip() {
        guard phase.optional else { return }
        advance(storing: false)
    }

    @objc private func handleNext() {
        advance(storing: true)
    }

    private func advance(storing: Bool) {
        if storing && !current.isEmpty {
            collected[phase.id] = current
        }

        current = []
        // Markers from finished phases stay on screen: seeing the floor points
        // while placing boxes is exactly the context that prevents a mistake.

        if phaseIndex + 1 < phases.count {
            phaseIndex += 1
            updateChrome()
            return
        }

        finish()
    }

    private func finish() {
        // The snapshot is taken before dismissal so the photograph in the
        // report shows exactly what was on screen when the points were placed,
        // markers included.
        let photo = sceneView.snapshot().jpegData(compressionQuality: 0.7)?
            .base64EncodedString()

        var cameraPosition: SIMD3<Float>?
        if let transform = sceneView.session.currentFrame?.camera.transform {
            let t = transform.columns.3
            cameraPosition = SIMD3<Float>(t.x, t.y, t.z)
        }

        let anyLowConfidence = collected.values.contains { points in
            points.contains { $0.confidence == .low }
        }
        if anyLowConfidence {
            warnings.append(
                "Some points were placed on an estimated surface rather than measured depth."
            )
        }

        onFinish?(CaptureOutcome(
            cancelled: false,
            phases: collected,
            cameraPosition: cameraPosition,
            photoBase64: photo,
            usedSceneDepth: usesSceneDepth,
            warnings: warnings
        ))
    }

    // MARK: - Chrome

    private func updateChrome() {
        let count = current.count
        let required = phase.minPoints

        let step = phases.count > 1 ? "Step \(phaseIndex + 1) of \(phases.count): " : ""
        instructionLabel.text = "  \(step)\(phase.instruction)  "

        var counter = count >= required
            ? "\(count) marked"
            : "\(count) marked — need at least \(required)"
        if let maxPoints = phase.maxPoints {
            counter = "\(count) of \(maxPoints) marked"
        }
        counterLabel.text = counter

        undoButton.isEnabled = count > 0
        undoButton.alpha = count > 0 ? 1 : 0.4

        skipButton.isHidden = !phase.optional

        let canAdvance = count >= required
        nextButton.isEnabled = canAdvance
        nextButton.alpha = canAdvance ? 1 : 0.4
        nextButton.setTitle(phaseIndex + 1 < phases.count ? "Next" : "Done", for: .normal)
    }

    private func flashInstruction(_ message: String) {
        let original = instructionLabel.text
        instructionLabel.text = "  \(message)  "
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            if self?.instructionLabel.text == "  \(message)  " {
                self?.instructionLabel.text = original
            }
        }
    }

    // MARK: - ARSessionDelegate

    func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        switch camera.trackingState {
        case .limited(let reason):
            sawLimitedTracking = true
            let text: String
            switch reason {
            case .excessiveMotion: text = "Slow down — moving too fast to track."
            case .insufficientFeatures: text = "Not enough detail here. Try more light or texture."
            case .initializing: text = "Starting up — move the phone gently side to side."
            case .relocalizing: text = "Re-finding the scene."
            @unknown default: text = "Tracking is limited."
            }
            flashInstruction(text)

            if !warnings.contains(where: { $0.hasPrefix("Tracking was limited") }) {
                warnings.append(
                    "Tracking was limited during this capture, which reduces positional accuracy."
                )
            }

        case .normal, .notAvailable:
            break

        @unknown default:
            break
        }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        warnings.append("The AR session failed: \(error.localizedDescription)")
        handleCancel()
    }
}
