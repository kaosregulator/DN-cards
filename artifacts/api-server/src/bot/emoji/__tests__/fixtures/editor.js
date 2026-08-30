// Fixture editor script. Deliberately does its work in the page and exposes a
// blob: preview + a download link, so discovery has to handle the client-side
// case rather than finding a convenient backend endpoint.
document.getElementById("generate").addEventListener("click", async () => {
  const input = document.getElementById("file");
  const file = input.files && input.files[0];
  if (!file) return;
  // A tiny valid GIF, so the retrieved bytes are a real image.
  const gif = Uint8Array.from(atob(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
  ), c => c.charCodeAt(0));
  const blob = new Blob([gif], { type: "image/gif" });
  const url = URL.createObjectURL(blob);
  document.getElementById("result").src = url;
  const link = document.getElementById("download");
  link.href = url;
  link.style.display = "inline";
});
