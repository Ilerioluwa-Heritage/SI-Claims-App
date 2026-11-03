// Hands a file to the browser to save, as a download.
export function save(fileName: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The bytes of a file the user picked. */
export async function bytesOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
