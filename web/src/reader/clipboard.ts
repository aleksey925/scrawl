export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  // a NAS on plain http has no navigator.clipboard, so keep execCommand alive
  const area = document.createElement('textarea');
  area.value = text;
  // readonly keeps the phone's keyboard down while the field holds the focus
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.opacity = '0';
  // iOS zooms the page into a field under 16px that takes the focus
  area.style.fontSize = '16px';
  document.body.appendChild(area);
  area.select();
  // iOS ignores select(), and takes a selection range even in a readonly field
  area.setSelectionRange(0, text.length);
  let done = false;
  try {
    done = document.execCommand('copy');
  } catch {
    done = false;
  }
  area.remove();
  return done;
}
