require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  # This name is not a choice, and it is not the plugin's JS name.
  #
  # Capacitor derives the pod name from the npm package name by pascal-casing
  # the hyphenated segments: capacitor-sitecheck-ar -> CapacitorSitecheckAr.
  # It writes that into the generated Podfile, and CocoaPods requires the
  # podspec file to be named <s.name>.podspec. Tidying this to SiteCheckAR
  # breaks the build with:
  #
  #   [!] No podspec found for `CapacitorSitecheckAr` in
  #       `../../packages/capacitor-sitecheck-ar`
  #
  # The JS side is unrelated: registerPlugin('SiteCheckAR') matches the
  # @objc(SiteCheckARPlugin) class, not this.
  s.name = 'CapacitorSitecheckAr'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://example.invalid/sitecheck'
  s.author = 'LiDAR Site Check'
  s.source = { :git => 'https://example.invalid/sitecheck.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  # ARKit raycasting needs 13.0; sceneReconstruction (the LiDAR path) needs
  # 13.4. 14.0 is a safe floor and matches the Capacitor 6 minimum.
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
  s.frameworks = 'ARKit', 'SceneKit', 'UIKit'
end
