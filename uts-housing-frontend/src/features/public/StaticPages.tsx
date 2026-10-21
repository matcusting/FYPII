import { Link } from 'react-router-dom'
import { secondaryButtonClass } from './ui'

export type StaticPageKind = 'privacy' | 'terms' | 'help'

export function StaticPage({ kind }: { kind: StaticPageKind }) {
  if (kind === 'privacy') return (
    <div className="mx-4 my-8 max-w-[1000px] rounded-xl border border-slate-200 bg-white px-6 py-9 text-slate-800 shadow-sm sm:mx-auto sm:w-[calc(100%-2rem)] sm:px-10 sm:py-11">
      <h1 className="border-b border-slate-200 pb-5 text-2xl font-bold text-[#203569]">隐私说明</h1>
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">这是一份功能说明草稿。数据保留期限、处理依据、联系人及完整法律文本须在正式上线前由项目负责人确认。</p>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">平台处理哪些资料</h2><p>账户资料包括姓名、邮箱和身份；自愿填写的学生资料可包括学校、预算、生活偏好与房源需求。发布房源、评论及联系请求时，平台还会处理相关内容。</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">公开展示与隐私控制</h2><p>公开房源展示大致地区，不默认展示住址。室友资料应由学生主动选择是否参与发现；联系信息应在双方适当同意后显示。认证证明文件不应公开展示。</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">账户与资料管理</h2><p>你可以在个人资料页面调整可用的展示与通知设置，暂停室友发现，并提出账户删除请求。具体的处理流程与时间尚待项目确认。</p></section>
      <p className="mt-10"><Link to="/help" className="font-semibold text-[#203569] underline">查看帮助</Link></p>
    </div>
  )

  if (kind === 'terms') return (
    <div className="mx-4 my-8 max-w-[1000px] rounded-xl border border-slate-200 bg-white px-6 py-9 text-slate-800 shadow-sm sm:mx-auto sm:w-[calc(100%-2rem)] sm:px-10 sm:py-11">
      <h1 className="border-b border-slate-200 pb-5 text-2xl font-bold text-[#203569]">使用条款</h1>
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">以下内容是项目功能草稿，不构成已经审定的法律条款。正式上线前需要补齐运营主体、争议处理及适用法律等内容。</p>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">账户与发布</h2><p>注册者应提供准确资料并保护账户安全。房源发布者应确认自己有权发布或转租，并提供真实的租金、可用日期与房源信息。平台公开展示房源前会进行审核。</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">联系与评价</h2><p>使用联系、室友匹配及评价功能时，请尊重他人隐私，避免骚扰、虚假信息与公开他人个人资料。评价应基于真实租住经历，可能需要提供证明并经过审核。</p></section>
      <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">房源与交易</h2><p>房源可用情况由发布者提供，联系时应再次确认。平台目前不处理租金、押金、租约或付款，也不提供资金托管。</p></section>
      <p className="mt-10"><Link to="/privacy" className="font-semibold text-[#203569] underline">查看隐私说明</Link></p>
    </div>
  )

  return (
    <div className="mx-4 my-8 max-w-[1000px] rounded-xl border border-slate-200 bg-white px-6 py-9 text-slate-800 shadow-sm sm:mx-auto sm:w-[calc(100%-2rem)] sm:px-10 sm:py-11">
      <h1 className="border-b border-slate-200 pb-5 text-2xl font-bold text-[#203569]">使用帮助</h1>
      <div className="mt-8 space-y-8">
        <section><h2 className="text-xl font-semibold">如何找房？</h2><p className="mt-2">在<Link to="/listings" className="font-semibold text-[#203569] underline">房源搜索</Link>页面按地区、租金和其他条件筛选。房源状态和可用日期应向发布者再次确认。</p></section>
        <section><h2 className="text-xl font-semibold">如何找室友？</h2><p className="mt-2">注册学生账户、完成要求的认证并在资料设置中主动开启发现后，可以查看匹配结果。匹配百分比描述偏好相近程度，不能保证合住体验。</p></section>
        <section><h2 className="text-xl font-semibold">如何发布房源？</h2><p className="mt-2">注册后在<Link to="/my-listings" className="font-semibold text-[#203569] underline">我的房源</Link>创建草稿，补齐资料与照片，再提交审核。学生转租应先核实租约和学校规定。</p></section>
        <section><h2 className="text-xl font-semibold">账户遇到问题？</h2><p className="mt-2">可以<Link to="/forgot-password" className="font-semibold text-[#203569] underline">重设密码</Link>。客服渠道与正式反馈流程尚待项目负责人配置。</p></section>
      </div>
    </div>
  )
}

export function NotFoundPage() {
  return (
    <div className="mx-4 my-8 flex min-h-[45vh] max-w-[1000px] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm sm:mx-auto sm:w-[calc(100%-2rem)]">
      <p className="text-5xl font-bold text-[#203569]">404</p>
      <h1 className="mt-4 text-3xl font-bold text-slate-950">找不到这个页面</h1>
      <p className="mt-3 text-slate-600">链接可能已更改，或页面暂时不可用。</p>
      <Link to="/" className={`${secondaryButtonClass} mt-7`}>返回首页</Link>
    </div>
  )
}
