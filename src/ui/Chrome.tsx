export function Logo() {
  return <img className="logo" src="/ui/logo.svg" alt="Vizzuality" width={107} height={24} />
}

/** North is always up: the Mapa is seen straight from above and never turns. */
export function Compass() {
  return (
    <div className="compass" aria-hidden>
      <span>N</span>
      <svg width="43" height="43" viewBox="0 0 43 43">
        <circle cx="21.5" cy="21.5" r="21" />
        <path d="M21.5 3.5L24 21.5L21.5 39.5L19 21.5Z" />
      </svg>
    </div>
  )
}
