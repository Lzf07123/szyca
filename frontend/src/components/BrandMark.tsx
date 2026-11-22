import { useLogoURL } from '../api/site'

export default function BrandMark({ variant }: { variant: 'header' | 'footer' | 'orbit' }) {
  const logoURL = useLogoURL()

  if (variant === 'orbit') {
    return logoURL ? (
      <img className="orbit-logo" src={logoURL} alt="" />
    ) : (
      <span className="orbit-code">CA</span>
    )
  }

  const className = variant === 'header' ? 'logo-mark' : 'footer-mark'
  return (
    <span className={`${className}${logoURL ? ' has-img' : ''}`} aria-hidden="true">
      {logoURL ? <img src={logoURL} alt="" /> : <span>CA</span>}
    </span>
  )
}
