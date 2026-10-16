/**
 * Download a protected file (it needs the access token, so a plain link will
 * not do): fetch it as a blob and hand it to the browser under a file name.
 */
import { apiErrorFrom, getAccessToken } from '../api/client';

export async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getAccessToken()}` }, credentials: 'include' });
  if (!res.ok) throw await apiErrorFrom(res);
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
