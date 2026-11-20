import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

/// Turns on the iPhone edge swipe for Back, and passes the real notch / status-bar height to the web app
/// as --safe-area-inset-* CSS variables, because WKWebView's env(safe-area-inset-top) can read 0 on some iPhones.
class SafeAreaBridgeViewController: CAPBridgeViewController, WKScriptMessageHandler {
    private var lastPushed = ""
    private var zeroRetries = 0

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
        webView?.configuration.userContentController.add(self, name: "safeArea")
        // A launch from a notification can start in the background with a zero safe area; re-send once the app is active.
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func appDidBecomeActive() {
        pushSafeArea(force: true)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        pushSafeArea(force: false)
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        pushSafeArea(force: true)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        pushSafeArea(force: true)
    }

    // The page asks on every load and whenever it comes back to the foreground.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        pushSafeArea(force: true)
    }

    private func pushSafeArea(force: Bool) {
        let insets = view.window?.safeAreaInsets ?? view.safeAreaInsets
        var top = insets.top
        if top == 0 {
            top = view.window?.windowScene?.statusBarManager?.statusBarFrame.height ?? 0
        }
        if top == 0 && zeroRetries < 20 {
            // Not laid out yet (e.g. launched in the background): try again shortly.
            zeroRetries += 1
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.pushSafeArea(force: true) }
        } else if top > 0 {
            zeroRetries = 0
        }
        // Never overwrite a real value with 0; the page then falls back to env(safe-area-inset-top).
        if top == 0 { return }
        let key = "\(top),\(insets.bottom),\(insets.left),\(insets.right)"
        if !force && key == lastPushed { return }
        lastPushed = key
        let js = "var s=document.documentElement.style;"
            + "s.setProperty('--safe-area-inset-top','\(top)px');"
            + "s.setProperty('--safe-area-inset-bottom','\(insets.bottom)px');"
            + "s.setProperty('--safe-area-inset-left','\(insets.left)px');"
            + "s.setProperty('--safe-area-inset-right','\(insets.right)px');"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }
}
