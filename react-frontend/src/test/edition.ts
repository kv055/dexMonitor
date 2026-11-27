import { EDITION_META_NAME } from '../edition';

/** Marks the test document as the public monitor deployment. */
export function setPublicEditionMeta(): void {
  clearEditionMeta();
  const meta = document.createElement('meta');
  meta.name = EDITION_META_NAME;
  meta.content = 'public';
  document.head.appendChild(meta);
}

export function clearEditionMeta(): void {
  document.head.querySelectorAll(`meta[name="${EDITION_META_NAME}"]`).forEach(meta => meta.remove());
}
