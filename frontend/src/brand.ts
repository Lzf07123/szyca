import type { HomeSection, SiteData } from './api/site'

// Brand copy and the static fallback live in one place. Runtime values returned
// by /api/site override these defaults without requiring a rebuild.
const fallbackSections: HomeSection[] = [
  {
    id: 1,
    kind: 'hero',
    plugin_version: 1,
    enabled: true,
    sort: 10,
    status: 'published',
    config: {
      eyebrow: '汕头职业技术学院 · 计算机协会',
      title: '把好奇心，写进每一行代码',
      subtitle: '招新答题、技术活动与同好社区，都在这里相遇。',
      primary_label: '开始答题',
      primary_to: '/quiz',
      secondary_label: '加入我们',
      secondary_to: '/join',
    },
  },
  {
    id: 2,
    kind: 'about',
    plugin_version: 1,
    enabled: true,
    sort: 20,
    status: 'published',
    config: {
      eyebrow: '关于协会',
      title: '一起学习，一起创造',
      body: '计算机协会面向所有对技术感兴趣的同学。我们用真实项目练习协作、工程与表达。',
    },
  },
  {
    id: 3,
    kind: 'activities',
    plugin_version: 1,
    enabled: true,
    sort: 30,
    status: 'published',
    config: {
      eyebrow: '持续发生',
      title: '不只是招新',
      items: [
        { title: '技术分享', body: '从 Web 开发到容器云，以能上手为目标组织分享。' },
        { title: '项目协作', body: '组队完成网站、工具与校园应用，积累可展示的作品。' },
        { title: '竞赛实践', body: '围绕真实赛题训练排障、工程化与团队配合。' },
      ],
    },
  },
  {
    id: 4,
    kind: 'quiz',
    plugin_version: 1,
    enabled: true,
    sort: 40,
    status: 'published',
    config: {
      eyebrow: '现场挑战',
      title: '招新答题',
      body: '选择难度，完成一轮答题，实时查看你的成绩与排名。',
      action_label: '进入答题',
      action_to: '/quiz',
    },
  },
  {
    id: 5,
    kind: 'join',
    plugin_version: 1,
    enabled: true,
    sort: 60,
    status: 'published',
    config: {
      eyebrow: '保持联系',
      title: '加入我们',
      body: '扫码加入招新群，不错过下一场活动。',
      action_label: '查看群二维码',
      action_to: '/join',
    },
  },
]

export const FALLBACK_SITE: SiteData = {
  brand: {
    name: '计算机协会',
    short_name: 'szyca',
    description: '汕头职业技术学院计算机协会：学习、协作与创造。',
    title: '计算机协会 · 官网',
    logo_url: '',
  },
  nav: [
    { label: '首页', to: '/' },
    { label: '加入我们', to: '/join' },
    { label: '答题', to: '/quiz' },
    { label: '排行榜', to: '/screen' },
  ],
  footer: {
    owner: '计算机协会 · 汕头职业技术学院',
    license: '开源协议：MIT',
    icp: '',
    icp_icon: '',
    police: '',
    police_icon: '',
    links: [
      { label: '关于协会', href: '/#about' },
      { label: '加入我们', href: '/join' },
      { label: '答题', href: '/quiz' },
      { label: '排行榜', href: '/screen' },
    ],
  },
  features: [
    { key: 'quiz', enabled: true, config: {} },
    { key: 'lottery', enabled: false, config: {} },
    { key: 'join', enabled: true, config: {} },
    { key: 'screen', enabled: true, config: {} },
  ],
  sections: fallbackSections,
  backgrounds: [],
  qrcodes: [],
}
