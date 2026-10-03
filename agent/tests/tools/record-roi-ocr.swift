// Records ROI-scoped OCR for a fixture, the way the Windows adapter reads (30 §7: ROI crop upscaled x2).
// Apple Vision stands in for Windows.Media.Ocr; H4 re-records on Windows.
// Usage: swift record-roi-ocr.swift <png> x,y,w,h [x,y,w,h ...]
// Prints JSON {"roiLines": [{"roi":[x,y,w,h], "lines":[{text,confidence,box}]}]} with boxes in 1920x1080 coords.
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 3, let img = NSImage(contentsOfFile: args[1]),
      let full = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("usage: record-roi-ocr <png> x,y,w,h ...\n", stderr); exit(1)
}
var out: [[String: Any]] = []
for spec in args.dropFirst(2) {
    let p = spec.split(separator: ",").compactMap { Int($0) }
    guard p.count == 4, let crop = full.cropping(to: CGRect(x: p[0], y: p[1], width: p[2], height: p[3])) else {
        fputs("bad roi \(spec)\n", stderr); exit(1)
    }
    let w = p[2] * 2, h = p[3] * 2
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(crop, in: CGRect(x: 0, y: 0, width: w, height: h))
    let scaled = ctx.makeImage()!
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: scaled).perform([req])
    var lines: [[String: Any]] = []
    for obs in (req.results ?? []) {
        guard let top = obs.topCandidates(1).first else { continue }
        let b = obs.boundingBox
        let x = p[0] + Int(b.minX * Double(p[2])), y = p[1] + Int((1 - b.maxY) * Double(p[3]))
        lines.append(["text": top.string, "confidence": Double(top.confidence),
                      "box": [x, y, Int(b.width * Double(p[2])), Int(b.height * Double(p[3]))]])
    }
    lines.sort { (($0["box"] as! [Int])[1], ($0["box"] as! [Int])[0]) < (($1["box"] as! [Int])[1], ($1["box"] as! [Int])[0]) }
    out.append(["roi": p, "lines": lines])
}
let data = try JSONSerialization.data(withJSONObject: ["engine": "apple-vision-accurate-roi-x2", "roiLines": out], options: [.prettyPrinted, .sortedKeys])
print(String(data: data, encoding: .utf8)!)
