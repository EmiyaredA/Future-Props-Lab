import AppKit
import CryptoKit
import Foundation

struct MacApp {
    let id: String
    let bundleID: String
    let url: URL
    let name: String

    var descriptor: [String: Any] {
        let popular = ["com.google.Chrome", "com.apple.Safari", "com.apple.TextEdit", "com.microsoft.VSCode"]
        return ["id": id, "name": String(name.prefix(160)), "recommended": popular.contains(bundleID)]
    }

    func matches(_ app: NSRunningApplication?) -> Bool {
        app?.bundleIdentifier == bundleID && app?.bundleURL?.resolvingSymlinksInPath().path == url.path
    }

    static func installed() -> [MacApp] {
        let manager = FileManager.default
        let roots = [
            URL(fileURLWithPath: "/Applications"),
            URL(fileURLWithPath: "/System/Applications"),
            manager.homeDirectoryForCurrentUser.appendingPathComponent("Applications"),
        ]
        var found: [String: MacApp] = [:]
        for root in roots where root.resolvingSymlinksInPath().path == root.path {
            guard let entries = manager.enumerator(
                at: root, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants]
            ) else { continue }
            for case let candidate as URL in entries {
                guard candidate.pathExtension.lowercased() == "app" else { continue }
                entries.skipDescendants()
                guard candidate.resolvingSymlinksInPath().path == candidate.path,
                      let bundle = Bundle(url: candidate),
                      let identifier = bundle.bundleIdentifier, !identifier.isEmpty,
                      identifier != "lab.futureprops.remoteapps",
                      let executable = bundle.executableURL,
                      executable.resolvingSymlinksInPath().path.hasPrefix(candidate.path + "/"),
                      manager.isExecutableFile(atPath: executable.path) else { continue }
                let label = (bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
                    ?? (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String) ?? ""
                let name = label.isEmpty ? candidate.deletingPathExtension().lastPathComponent : label
                let hash = SHA256.hash(data: Data((identifier + "\0" + candidate.path).utf8))
                let id = hash.map { String(format: "%02x", $0) }.joined()
                found[id] = MacApp(id: id, bundleID: identifier, url: candidate, name: name)
            }
        }
        return found.values.sorted {
            let order = $0.name.localizedStandardCompare($1.name)
            return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
        }
    }
}
