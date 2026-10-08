// Dessine l'icône de l'application (1024 × 1024) aux couleurs Nocturne : swift desktop/icon.swift sortie.png
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

func color(_ hex: UInt32, _ a: CGFloat = 1) -> NSColor {
  NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a)
}

// Fond : carré arrondi façon macOS (marge de 100 px, rayon 185), dégradé sombre avec halo violet.
let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
let shape = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)
NSGradient(colors: [color(0x2b2741), color(0x161826)], atLocations: [0, 1], colorSpace: .sRGB)!.draw(in: shape, angle: -90)
NSGraphicsContext.current?.saveGraphicsState()
shape.addClip()
NSGradient(colors: [color(0x5d5294, 0.55), color(0x5d5294, 0)])!.draw(fromCenter: NSPoint(x: 760, y: 820), radius: 0, toCenter: NSPoint(x: 760, y: 820), radius: 620, options: [])
NSGraphicsContext.current?.restoreGraphicsState()

// Marque Cursus : carré arrondi au trait accent et coche.
let mark = NSRect(x: 312, y: 312, width: 400, height: 400)
let markPath = NSBezierPath(roundedRect: mark, xRadius: 108, yRadius: 108)
markPath.lineWidth = 26
color(0x9184d9).setStroke()
markPath.stroke()
let check = NSBezierPath()
check.move(to: NSPoint(x: 404, y: 512))
check.line(to: NSPoint(x: 476, y: 440))
check.line(to: NSPoint(x: 624, y: 588))
check.lineWidth = 40
check.lineCapStyle = .round
check.lineJoinStyle = .round
color(0xb5abfc).setStroke()
check.stroke()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
