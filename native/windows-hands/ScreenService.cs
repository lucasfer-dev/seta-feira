using System;
using System.Drawing;
using System.Drawing.Drawing2D;
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

            var maxWidth = ClampEnv("SEXTA_VISION_MAX_WIDTH", 1152, 900, 1440);
            var quality = ClampEnv("SEXTA_VISION_JPEG_QUALITY", 62, 45, 78);

            using (var source = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
            {
                using (var graphics = Graphics.FromImage(source))
                {
                    graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                }

                Bitmap output = source;
                Bitmap resized = null;
                try
                {
                    if (source.Width > maxWidth)
                    {
                        var ratio = maxWidth / (double)source.Width;
                        var targetHeight = Math.Max(1, (int)Math.Round(source.Height * ratio));
                        resized = new Bitmap(maxWidth, targetHeight, PixelFormat.Format24bppRgb);
                        using (var graphics = Graphics.FromImage(resized))
                        {
                            graphics.CompositingQuality = CompositingQuality.HighQuality;
                            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            graphics.SmoothingMode = SmoothingMode.HighQuality;
                            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                            graphics.DrawImage(source, 0, 0, maxWidth, targetHeight);
                        }
                        output = resized;
                    }

                    var bytes = EncodeJpeg(output, quality);
                    if (bytes.Length > 1_350_000 && quality > 45) bytes = EncodeJpeg(output, 45);
                    if (bytes.Length > 1_350_000) throw new InvalidOperationException("PC_SCREEN_CAPTURE_TOO_LARGE");

                    return new
                    {
                        scope = normalized,
                        width = output.Width,
                        height = output.Height,
                        sourceWidth = bounds.Width,
                        sourceHeight = bounds.Height,
                        x = bounds.Left,
                        y = bounds.Top,
                        bytes = bytes.Length,
                        mimeType = "image/jpeg",
                        imageBase64 = Convert.ToBase64String(bytes),
                        provider = "native-gdi-v3"
                    };
                }
                finally
                {
                    if (resized != null) resized.Dispose();
                }
            }
        }

        private static byte[] EncodeJpeg(Bitmap bitmap, long quality)
        {
            var codec = FindJpegCodec();
            using (var stream = new MemoryStream())
            {
                if (codec == null)
                {
                    bitmap.Save(stream, ImageFormat.Jpeg);
                }
                else
                {
                    using (var parameters = new EncoderParameters(1))
                    {
                        parameters.Param[0] = new EncoderParameter(Encoder.Quality, quality);
                        bitmap.Save(stream, codec, parameters);
                    }
                }
                return stream.ToArray();
            }
        }

        private static ImageCodecInfo FindJpegCodec()
        {
            foreach (var codec in ImageCodecInfo.GetImageEncoders())
            {
                if (string.Equals(codec.MimeType, "image/jpeg", StringComparison.OrdinalIgnoreCase)) return codec;
            }
            return null;
        }

        private static int ClampEnv(string name, int fallback, int min, int max)
        {
            int parsed;
            var raw = Environment.GetEnvironmentVariable(name);
            if (!int.TryParse(raw, out parsed)) parsed = fallback;
            return Math.Max(min, Math.Min(max, parsed));
        }
    }
}
