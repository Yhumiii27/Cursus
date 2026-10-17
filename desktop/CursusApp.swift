// Cursus — application de bureau macOS.
// Démarre le serveur Cursus (Node) en local, affiche l'interface dans une fenêtre native (WKWebView)
// et arrête le serveur à la fermeture. Les chemins (projet, Node, port) sont lus dans Info.plist,
// renseignés par desktop/build-app.sh.
import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var popups: [NSWindow] = []
  private var server: Process?
  private var logHandle: FileHandle?
  private var readyTimer: Timer?
  private var startedAt = Date()
  private var loadedApp = false
  private var quitting = false
  private var destinations: [ObjectIdentifier: URL] = [:]

  private let info = Bundle.main.infoDictionary ?? [:]
  private var projectDir: String { info["CursusProjectDir"] as? String ?? "" }
  private var nodePath: String { info["CursusNodePath"] as? String ?? "/opt/homebrew/bin/node" }
  private var port: Int { Int(info["CursusPort"] as? String ?? "") ?? 3217 }
  private var baseURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }
  private let logDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Cursus")
  private var serverLog: URL { logDir.appendingPathComponent("serveur.log") }

  // MARK: Cycle de vie

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.appearance = NSAppearance(named: .darkAqua)
    buildMenu()
    buildWindow()
    showStatus("Démarrage de Cursus…", detail: nil)
    startServerIfNeeded()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationWillTerminate(_ notification: Notification) {
    quitting = true
    readyTimer?.invalidate()
    guard let p = server, p.isRunning else { return }
    p.terminate()
    let deadline = Date().addingTimeInterval(3)
    while p.isRunning && Date() < deadline { usleep(50_000) }
    if p.isRunning { kill(p.processIdentifier, SIGKILL) }
  }

  // MARK: Serveur Node

  private func startServerIfNeeded() {
    // Un serveur Cursus répond déjà sur ce port (application relancée) : on le réutilise.
    probe { [weak self] alive in
      guard let self else { return }
      if alive { self.loadApp(); return }
      self.launchServer()
    }
  }

  private func launchServer() {
    let fm = FileManager.default
    guard fm.fileExists(atPath: projectDir + "/server/src/index.ts") else {
      return fail("Dossier du projet introuvable", detail: "Attendu : \(projectDir)\nReconstruisez l’application avec « npm run app » depuis le dossier Cursus.")
    }
    guard fm.isExecutableFile(atPath: nodePath) else {
      return fail("Node.js introuvable", detail: "Attendu : \(nodePath)\nInstallez Node.js 22.18 ou plus récent puis reconstruisez l’application (« npm run app »).")
    }
    try? fm.createDirectory(at: logDir, withIntermediateDirectories: true)
    fm.createFile(atPath: serverLog.path, contents: nil)
    logHandle = try? FileHandle(forWritingTo: serverLog)

    let p = Process()
    p.executableURL = URL(fileURLWithPath: nodePath)
    p.arguments = ["server/src/index.ts"]
    p.currentDirectoryURL = URL(fileURLWithPath: projectDir)
    var env = ProcessInfo.processInfo.environment
    env["NODE_ENV"] = "production"
    // Journal local lu par une personne (dialogue d’erreur, tailLog) : texte, pas JSON.
    env["CURSUS_LOG_FORMAT"] = "texte"
    env["CURSUS_API_PORT"] = String(port)
    env["CURSUS_HOST"] = "127.0.0.1"
    env["CURSUS_INSECURE_COOKIE"] = "1"  // http://127.0.0.1 : cookie de session sans l'attribut Secure
    // Démonstration sur la boucle locale : seule configuration de démonstration admise en production.
    env["CURSUS_DEMO"] = "1"
    env["CURSUS_SECRET"] = sessionSecret()
    env["KEYSTONE_API_KEY"] = "demo-keystone"  // clé de démonstration, joignable depuis ce Mac uniquement
    env.removeValue(forKey: "CURSUS_TODAY")    // refusée en production : date réelle
    env["PATH"] = (nodePath as NSString).deletingLastPathComponent + ":/usr/bin:/bin:/usr/sbin:/sbin"
    p.environment = env
    if let h = logHandle { p.standardOutput = h; p.standardError = h }
    p.terminationHandler = { [weak self] proc in
      DispatchQueue.main.async {
        guard let self, !self.quitting, self.server === proc else { return }
        self.readyTimer?.invalidate(); self.readyTimer = nil
        self.fail("Le serveur Cursus s’est arrêté (code \(proc.terminationStatus))", detail: self.tailLog())
      }
    }
    do {
      try p.run()
      server = p
    } catch {
      return fail("Impossible de démarrer le serveur", detail: error.localizedDescription)
    }
    startedAt = Date()
    readyTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.waitUntilReady() }
  }

  /// Clé de signature des sessions, propre à ce Mac : créée au premier lancement, lisible par l'utilisateur seul.
  private func sessionSecret() -> String {
    let fm = FileManager.default
    let dir = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Cursus")
    let file = dir.appendingPathComponent("cle-sessions")
    if let s = try? String(contentsOf: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), s.count >= 32 { return s }
    let s = (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    fm.createFile(atPath: file.path, contents: Data(s.utf8), attributes: [.posixPermissions: 0o600])
    return s
  }

  private func waitUntilReady() {
    probe { [weak self] alive in
      guard let self, self.readyTimer != nil else { return }
      if alive {
        self.readyTimer?.invalidate(); self.readyTimer = nil
        self.loadApp()
      } else if Date().timeIntervalSince(self.startedAt) > 25 {
        self.readyTimer?.invalidate(); self.readyTimer = nil
        self.fail("Le serveur Cursus ne répond pas", detail: self.tailLog())
      }
    }
  }

  /// Le port répond-il comme un serveur Cursus ? (GET /api/session renvoie un objet avec « demo ».)
  private func probe(_ done: @escaping (Bool) -> Void) {
    var req = URLRequest(url: baseURL.appendingPathComponent("api/session"))
    req.timeoutInterval = 1
    URLSession.shared.dataTask(with: req) { data, _, _ in
      let ok = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["demo"] != nil
      DispatchQueue.main.async { done(ok) }
    }.resume()
  }

  private func tailLog() -> String {
    let text = (try? String(contentsOf: serverLog, encoding: .utf8)) ?? ""
    let lines = text.split(separator: "\n", omittingEmptySubsequences: false).suffix(12).joined(separator: "\n")
    return (lines.isEmpty ? "" : lines + "\n\n") + "Journal complet : \(serverLog.path)"
  }

  // MARK: Fenêtre et interface web

  private func buildWindow() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    // window.print() n'est pas pris en charge par WKWebView : il est relayé vers l'impression native.
    let printShim = WKUserScript(source: "window.print = function () { window.webkit.messageHandlers.cursusPrint.postMessage(null); };",
                                 injectionTime: .atDocumentStart, forMainFrameOnly: false)
    config.userContentController.addUserScript(printShim)
    config.userContentController.add(self, name: "cursusPrint")
    config.preferences.javaScriptCanOpenWindowsAutomatically = true

    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsMagnification = true
    webView.setValue(false, forKey: "drawsBackground")

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable],
                      backing: .buffered, defer: false)
    window.title = "Cursus"
    window.tabbingMode = .disallowed
    window.backgroundColor = NSColor(srgbRed: 0x16 / 255, green: 0x18 / 255, blue: 0x26 / 255, alpha: 1)
    window.minSize = NSSize(width: 1024, height: 680)
    window.contentView = webView
    window.center()
    window.setFrameAutosaveName("CursusMainWindow")
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private func loadApp() {
    loadedApp = true
    webView.load(URLRequest(url: baseURL))
  }

  private func showStatus(_ title: String, detail: String?) {
    let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
    let html = """
    <!doctype html><html lang="fr"><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#161826;color:#e9e9ed;font:15px/1.5 -apple-system,system-ui,sans-serif}
    main{height:100%;display:grid;place-items:center} .box{max-width:620px;padding:24px}
    .mark{width:40px;height:40px;border:1.5px solid #9184d9;border-radius:11px;display:grid;place-items:center;color:#9184d9;font-size:22px;margin-bottom:16px}
    h1{font-weight:500;font-size:22px;margin:0 0 8px} pre{white-space:pre-wrap;color:#b2b6ca;font:12px/1.5 ui-monospace,Menlo,monospace;background:#232532;padding:12px;border-radius:8px}
    </style><main><div class="box"><div class="mark">✓</div><h1>\(esc(title))</h1>\(detail.map { "<pre>\(esc($0))</pre>" } ?? "")</div></main></html>
    """
    webView.loadHTMLString(html, baseURL: nil)
  }

  private func fail(_ title: String, detail: String) {
    loadedApp = false
    showStatus(title, detail: detail)
  }

  // MARK: Navigation : liens externes dans le navigateur, téléchargements dans Téléchargements

  private func isLocal(_ url: URL?) -> Bool {
    guard let url else { return true }
    if ["about", "blob", "data"].contains(url.scheme ?? "") { return true }
    return url.host == "127.0.0.1" || url.host == "localhost"
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    if !isLocal(action.request.url) {
      if let url = action.request.url { NSWorkspace.shared.open(url) }
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(response.canShowMIMEType ? .allow : .download)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
    let base = (suggestedFilename as NSString).deletingPathExtension, ext = (suggestedFilename as NSString).pathExtension
    var target = dir.appendingPathComponent(suggestedFilename)
    var n = 2
    while FileManager.default.fileExists(atPath: target.path) {
      target = dir.appendingPathComponent("\(base) (\(n))" + (ext.isEmpty ? "" : ".\(ext)")); n += 1
    }
    destinations[ObjectIdentifier(download)] = target
    completionHandler(target)
  }

  func downloadDidFinish(_ download: WKDownload) {
    if let target = destinations.removeValue(forKey: ObjectIdentifier(download)) {
      NSWorkspace.shared.activateFileViewerSelecting([target])
    }
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    destinations.removeValue(forKey: ObjectIdentifier(download))
    alert("Téléchargement impossible", error.localizedDescription)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    if webView === self.webView && loadedApp { fail("Cursus est injoignable", detail: error.localizedDescription + "\n\n" + tailLog()) }
  }

  // MARK: Fenêtres secondaires (documents imprimables), boîtes de dialogue, sélection de fichiers

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url, !isLocal(url) { NSWorkspace.shared.open(url); return nil }
    let child = WKWebView(frame: .zero, configuration: configuration)
    child.uiDelegate = self
    child.navigationDelegate = self
    let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 1000), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
    w.title = "Cursus — document"
    w.contentView = child
    w.isReleasedWhenClosed = false
    w.cascadeTopLeft(from: window.frame.origin)
    w.center()
    w.makeKeyAndOrderFront(nil)
    popups.append(w)
    NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self] _ in
      self?.popups.removeAll { $0 === w }
    }
    return child
  }

  func webViewDidClose(_ webView: WKWebView) { webView.window?.close() }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    alert("Cursus", message); completionHandler()
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert()
    a.messageText = message
    a.addButton(withTitle: "Confirmer")
    a.addButton(withTitle: "Annuler")
    completionHandler(a.runModal() == .alertFirstButtonReturn)
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    let a = NSAlert()
    a.messageText = prompt
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
    field.stringValue = defaultText ?? ""
    a.accessoryView = field
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Annuler")
    completionHandler(a.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.canChooseFiles = true
    panel.begin { completionHandler($0 == .OK ? panel.urls : nil) }
  }

  private func alert(_ title: String, _ text: String) {
    let a = NSAlert()
    a.messageText = title
    a.informativeText = text
    a.runModal()
  }

  // MARK: Impression

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "cursusPrint", let wv = message.webView else { return }
    printWebView(wv)
  }

  private func printWebView(_ wv: WKWebView) {
    guard let w = wv.window else { return }
    let info = NSPrintInfo.shared.copy() as! NSPrintInfo
    info.horizontalPagination = .fit
    info.verticalPagination = .automatic
    info.topMargin = 28; info.bottomMargin = 28; info.leftMargin = 28; info.rightMargin = 28
    let op = wv.printOperation(with: info)
    op.view?.frame = wv.bounds
    op.showsPrintPanel = true
    op.showsProgressPanel = true
    op.runModal(for: w, delegate: nil, didRun: nil, contextInfo: nil)
  }

  @objc private func printFront(_ sender: Any?) {
    let wv = (NSApp.keyWindow?.contentView as? WKWebView) ?? webView!
    printWebView(wv)
  }

  // MARK: Menus

  @objc private func reload(_ sender: Any?) {
    if loadedApp { webView.reload() } else { startServerIfNeeded() }
  }
  @objc private func openInBrowser(_ sender: Any?) { NSWorkspace.shared.open(baseURL) }
  @objc private func showLog(_ sender: Any?) { NSWorkspace.shared.activateFileViewerSelecting([serverLog]) }
  @objc private func zoomIn(_ sender: Any?) { webView.pageZoom = min(2, webView.pageZoom + 0.1) }
  @objc private func zoomOut(_ sender: Any?) { webView.pageZoom = max(0.5, webView.pageZoom - 0.1) }
  @objc private func zoomReset(_ sender: Any?) { webView.pageZoom = 1 }

  private func buildMenu() {
    let main = NSMenu()
    func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
      let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
      i.keyEquivalentModifierMask = mods
      i.target = target
      return i
    }
    func submenu(_ title: String, _ items: [NSMenuItem]) {
      let m = NSMenu(title: title)
      items.forEach { m.addItem($0) }
      let holder = NSMenuItem()
      holder.submenu = m
      main.addItem(holder)
    }
    submenu("Cursus", [
      item("À propos de Cursus", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
      .separator(),
      item("Masquer Cursus", #selector(NSApplication.hide(_:)), "h"),
      item("Masquer les autres", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      .separator(),
      item("Quitter Cursus", #selector(NSApplication.terminate(_:)), "q"),
    ])
    submenu("Fichier", [
      item("Imprimer…", #selector(printFront(_:)), "p", target: self),
      .separator(),
      item("Ouvrir dans le navigateur", #selector(openInBrowser(_:)), "o", [.command, .shift], target: self),
      item("Afficher le journal du serveur", #selector(showLog(_:)), "", target: self),
      .separator(),
      item("Fermer la fenêtre", #selector(NSWindow.performClose(_:)), "w"),
    ])
    submenu("Édition", [
      item("Annuler", Selector(("undo:")), "z"),
      item("Rétablir", Selector(("redo:")), "z", [.command, .shift]),
      .separator(),
      item("Couper", #selector(NSText.cut(_:)), "x"),
      item("Copier", #selector(NSText.copy(_:)), "c"),
      item("Coller", #selector(NSText.paste(_:)), "v"),
      item("Tout sélectionner", #selector(NSText.selectAll(_:)), "a"),
    ])
    submenu("Présentation", [
      item("Recharger", #selector(reload(_:)), "r", target: self),
      .separator(),
      item("Zoom avant", #selector(zoomIn(_:)), "+", target: self),
      item("Zoom arrière", #selector(zoomOut(_:)), "-", target: self),
      item("Taille réelle", #selector(zoomReset(_:)), "0", target: self),
      .separator(),
      item("Plein écran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
    ])
    let windowMenu = NSMenu(title: "Fenêtre")
    windowMenu.addItem(item("Réduire", #selector(NSWindow.performMiniaturize(_:)), "m"))
    windowMenu.addItem(item("Zoom", #selector(NSWindow.performZoom(_:))))
    let wHolder = NSMenuItem()
    wHolder.submenu = windowMenu
    main.addItem(wHolder)
    NSApp.windowsMenu = windowMenu
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
