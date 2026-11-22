import { Link } from 'react-router-dom'
import { useSite } from '../api/site'
import BrandMark from './BrandMark'

export default function Footer() {
  const { site } = useSite()
  const { footer, brand } = site

  return (
    <footer className="footer public-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <BrandMark variant="footer" />
          <div>
            <strong>{footer.owner || brand.name}</strong>
            <p>学习 / 协作 / 创造</p>
          </div>
        </div>
        <nav className="footer-links" aria-label="页脚导航">
          {footer.links.map((link) =>
            link.href.startsWith('/') ? (
              <Link key={link.href} to={link.href}>{link.label}</Link>
            ) : (
              <a key={link.href} href={link.href}>{link.label}</a>
            ),
          )}
        </nav>
        <div className="footer-meta">
          <span>© {new Date().getFullYear()} {footer.owner || brand.name}</span>
          {footer.license && <span>{footer.license}</span>}
          {footer.icp && (
            <a className="beian" href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
              {footer.icp_icon && <img src={footer.icp_icon} alt="" />}
              {footer.icp}
            </a>
          )}
          {footer.police && (
            <a className="beian" href="https://beian.mps.gov.cn/" target="_blank" rel="noreferrer">
              {footer.police_icon && <img src={footer.police_icon} alt="" />}
              {footer.police}
            </a>
          )}
        </div>
        <div className="footer-terminal">
          <span><i aria-hidden="true">&gt;</i> connection closed</span>
          <b>EOF — 感谢阅读到底部</b>
          <span>NEBULA_OS / STPT</span>
        </div>
      </div>
    </footer>
  )
}
