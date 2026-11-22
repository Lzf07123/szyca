import { useLogoURL } from '../api/site'

export default function BrandMark({ variant }: { variant: 'header' | 'footer' }) {
  const logoURL = useLogoURL()

  const className = variant === 'header' ? 'logo-mark' : 'footer-mark'
  return (
    <span className={`${className}${logoURL ? ' has-img' : ''}`} aria-hidden="true">
      {logoURL ? <img src={logoURL} alt="" /> : <span>CA</span>}
    </span>
  )
}
