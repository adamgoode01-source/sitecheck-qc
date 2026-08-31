import ARKit
import Capacitor
import Foundation

/**
 Capacitor bridge for ARKit measurement.

 The web layer calls `startCapture` with a list of PHASES — "mark each stud",
 or "mark the floor, then the datum, then each box" — and this presents a
 full-screen AR view that walks through them. Positions come back in ARKit
 world space, in METRES, keyed by phase id. The TypeScript side converts to
 inches at the boundary (`src/measurement/arkit.ts`) so nothing else has to
 think about units.

 Anything this cannot measure reliably is reported as such rather than
 smoothed over. A low-confidence point that looks like a good one is worse
 than no point at all, because the whole purpose of the app is to be trusted
 in a dispute.
 */
@objc(SiteCheckARPlugin)
public class SiteCheckARPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SiteCheckARPlugin"
    public let jsName = "SiteCheckAR"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startCapture", returnType: CAPPluginReturnPromise)
    ]

    private var activeController: ARMeasureViewController?

    @objc func isSupported(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.isSupported else {
            call.resolve([
                "supported": false,
                "hasLiDAR": false,
                "reason": "This device does not support ARKit world tracking."
            ])
            return
        }

        // Scene reconstruction is the LiDAR path. Without it ARKit still
        // measures, but against estimated planes rather than sensed depth,
        // which is materially less accurate on a jobsite.
        let hasLiDAR = ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)

        call.resolve(["supported": true, "hasLiDAR": hasLiDAR])
    }

    @objc func startCapture(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "Measure"

        guard let rawPhases = call.getArray("phases") as? [[String: Any]], !rawPhases.isEmpty else {
            call.reject("startCapture requires at least one phase.")
            return
        }

        let phases: [CapturePhase] = rawPhases.compactMap { raw in
            guard let id = raw["id"] as? String else { return nil }
            return CapturePhase(
                id: id,
                title: raw["title"] as? String ?? "Mark points",
                instruction: raw["instruction"] as? String ?? "Tap each point.",
                minPoints: raw["minPoints"] as? Int ?? 1,
                maxPoints: raw["maxPoints"] as? Int,
                optional: raw["optional"] as? Bool ?? false
            )
        }

        guard !phases.isEmpty else {
            call.reject("No usable phases were supplied — each needs an id.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self, let bridge = self.bridge, let root = bridge.viewController else {
                call.reject("No view controller is available to present the AR capture.")
                return
            }

            let controller = ARMeasureViewController(titleText: title, phases: phases)

            controller.onFinish = { [weak self] outcome in
                self?.activeController = nil
                root.dismiss(animated: true) {
                    call.resolve(Self.serialise(outcome))
                }
            }

            controller.modalPresentationStyle = .fullScreen
            self.activeController = controller
            root.present(controller, animated: true)
        }
    }

    private static func serialise(_ outcome: CaptureOutcome) -> [String: Any] {
        var phases: [String: Any] = [:]
        for (id, points) in outcome.phases {
            phases[id] = points.map(serialise)
        }

        var payload: [String: Any] = [
            "cancelled": outcome.cancelled,
            "phases": phases,
            "usedSceneDepth": outcome.usedSceneDepth,
            "warnings": outcome.warnings
        ]

        if let camera = outcome.cameraPosition {
            payload["cameraPosition"] = ["x": camera.x, "y": camera.y, "z": camera.z]
        }
        if let photo = outcome.photoBase64 {
            payload["photoBase64"] = photo
        }

        return payload
    }

    private static func serialise(_ point: MeasuredPoint) -> [String: Any] {
        [
            "x": point.position.x,
            "y": point.position.y,
            "z": point.position.z,
            "confidence": point.confidence.rawValue
        ]
    }
}
