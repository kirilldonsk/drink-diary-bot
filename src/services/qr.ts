import QRCode from "qrcode";

export async function generateQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: 720,
    color: {
      dark: "#111111",
      light: "#ffffff"
    }
  });
}
