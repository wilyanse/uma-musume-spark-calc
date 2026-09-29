// Spike: OCR a screenshot with Apple Vision and print text + normalized boxes (1920x1080 px coords).
// Proxy for Windows.Media.Ocr accuracy on game fonts. Usage: swift ocr.swift <image> [x y w h]
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2, let img = NSImage(contentsOfFile: args[1]),
      var cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("usage: ocr <image> [x y w h]\n", stderr); exit(1)
}
var ox = 0, oy = 0
if args.count == 6, let x = Int(args[2]), let y = Int(args[3]), let w = Int(args[4]), let h = Int(args[5]) {
    cg = cg.cropping(to: CGRect(x: x, y: y, width: w, height: h))!
    ox = x; oy = y
}
let W = Double(cg.width), H = Double(cg.height)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg).perform([req])
let asJson = ProcessInfo.processInfo.environment["OCR_JSON"] == "1"
var lines: [[String: Any]] = []
for obs in (req.results ?? []) {
    guard let top = obs.topCandidates(1).first else { continue }
    let b = obs.boundingBox
    let x = Int(b.minX * W) + ox, y = Int((1 - b.maxY) * H) + oy
    let w = Int(b.width * W), h = Int(b.height * H)
    if asJson {
        lines.append(["text": top.string, "confidence": Double(top.confidence), "box": [x, y, w, h]])
    } else {
        print(String(format: "%4d,%4d %3dx%2d  %.2f  %@", x, y, w, h, top.confidence, top.string))
    }
}
if asJson {
    lines.sort { (($0["box"] as! [Int])[1], ($0["box"] as! [Int])[0]) < (($1["box"] as! [Int])[1], ($1["box"] as! [Int])[0]) }
    let doc: [String: Any] = ["engine": "apple-vision-accurate", "reference": [1920, 1080], "lines": lines]
    let data = try JSONSerialization.data(withJSONObject: doc, options: [.prettyPrinted, .sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
