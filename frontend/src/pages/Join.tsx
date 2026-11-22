import PageMeta from '../components/PageMeta'
import PageIntro from '../components/PageIntro'
import { useSite } from '../api/site'

export default function Join() {
  const { site } = useSite()
  const qrcodes = site.qrcodes

  return (
    <>
      <PageMeta
        title={`加入我们 · ${site.brand.name}`}
        description="扫码加入计算机协会招新群，获取招新、活动和技术分享资讯。"
      />
      <section className="join-page">
        <PageIntro
          className="join-head"
          eyebrow="JOIN THE COMMUNITY / 加入我们"
          title="加入我们"
          description="扫码加入招新群，或关注协会公众号。名额与活动信息以现场发布为准。"
        />
        {qrcodes.length > 0 ? (
          <div className="qr-grid">
            {qrcodes.map((qrcode) => (
              <figure className="qr-item" key={qrcode.id}>
                <img className="qrcode-img" src={qrcode.image_url} alt={qrcode.title || '加入计算机协会二维码'} />
                {qrcode.title && <figcaption className="qr-title">{qrcode.title}</figcaption>}
              </figure>
            ))}
          </div>
        ) : (
          <div className="qrcode-placeholder">
            <strong>二维码暂未配置</strong>
            <span>请联系现场工作人员，或稍后刷新页面。</span>
          </div>
        )}
      </section>
    </>
  )
}
