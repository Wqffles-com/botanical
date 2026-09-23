export function openProfileSwitcher() {
  window.dispatchEvent(new CustomEvent('botanical:ui', { detail: 'profile' }))
}

export function openNewChat() {
  window.dispatchEvent(new CustomEvent('botanical:ui', { detail: 'new-chat' }))
}
