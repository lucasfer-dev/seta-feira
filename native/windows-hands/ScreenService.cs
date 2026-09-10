using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

namespace Sexta.NativeHands
{
    internal static class ScreenService
    {
        internal static object Capture(string scope)
        {
            var normalized = string.Equals(scope, "all", StringComparison.OrdinalIgnoreCase) ? "all" : "primary";
            var bounds = normalized == "all" ? SystemInformation.VirtualScreen : Screen.PrimaryScreen.Bounds;
            if (bounds.Width <= 0 || bounds.Height <= 0) throw new InvalidOperationException("PC_SCREEN_CAPTURE_INVALID_BOUNDS");

            using (var bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
            using (var graphics = Graphics.FromImage(bitmap))
            using (var stream = new MemoryStream())
            {
                graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                bitmap.Save(stream, ImageFormat.Png);
                var bytes = stream.ToArray();
                return new
                {
                    scope = normalized,
                    width = bounds.Width,
                    height = bounds.Height,
                    x = bounds.Left,
                    y = bounds.Top,
                    bytes = bytes.Length,
                    imageBase64 = Convert.ToBase64String(bytes),
                    provider = "native-gdi-v3"
                };
            }
        }
    }
}
