import {
  LayoutDashboard,
  ListChecks,
  PenLine,
  ImageIcon,
  BarChart3,
  Eye,
  TrendingUp,
  Search,
  Globe,
  MessageSquare,
  Link2,
  Users,
  Mail,
  Megaphone,
  Bot,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface SidebarItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  disabled?: boolean;
  tooltip?: string;
  matchPaths?: string[];
  requiredRole?: string;
}

export interface SidebarSection {
  id: string;
  label: string;
  collapsible: boolean;
  items: SidebarItem[];
}

export const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    id: 'workspace',
    label: '',
    collapsible: false,
    items: [
      { id: 'mission-control', label: 'Mission Control', href: '/mission-control', icon: LayoutDashboard },
      { id: 'action-center', label: 'Action Center', href: '#', icon: ListChecks, disabled: true, tooltip: 'Coming soon' },
      { id: 'editor', label: 'The Editor', href: '/documents', icon: PenLine, matchPaths: ['/documents'] },
      { id: 'assets', label: 'Assets & Media', href: '#', icon: ImageIcon, disabled: true, tooltip: 'Coming soon' },
    ],
  },
  {
    id: 'reporting',
    label: 'Reporting & Analytics',
    collapsible: true,
    items: [
      { id: 'executive-overview', label: 'Executive Overview', href: '#', icon: BarChart3, disabled: true, tooltip: 'Coming soon' },
      { id: 'ai-visibility', label: 'AI Visibility & SEO', href: '#', icon: Eye, disabled: true, tooltip: 'Coming soon' },
      { id: 'acquisition', label: 'Acquisition & Conversion', href: '#', icon: TrendingUp, disabled: true, tooltip: 'Coming soon' },
    ],
  },
  {
    id: 'seo-content',
    label: 'SEO & Content',
    collapsible: true,
    items: [
      { id: 'keywords', label: 'Keywords & Tracking', href: '/keywords', icon: Search },
      { id: 'pages', label: 'Pages & Crawler', href: '/pages', icon: Globe },
      { id: 'review', label: 'Review Dashboard', href: '/review', icon: MessageSquare },
      { id: 'backlinks', label: 'Backlinks', href: '#', icon: Link2, disabled: true, tooltip: 'Coming soon' },
    ],
  },
  {
    id: 'acquisition-outreach',
    label: 'Acquisition & Outreach',
    collapsible: true,
    items: [
      { id: 'leads', label: 'Lead Management', href: '#', icon: Users, disabled: true, tooltip: 'Coming soon' },
      { id: 'email', label: 'Email Campaigns', href: '#', icon: Mail, disabled: true, tooltip: 'Coming soon' },
      { id: 'ads', label: 'Paid Ads', href: '#', icon: Megaphone, disabled: true, tooltip: 'Coming soon' },
    ],
  },
  {
    id: 'agents-workflows',
    label: 'Agents & Workflows',
    collapsible: true,
    items: [
      { id: 'agent-blueprints', label: 'Agent Blueprints', href: '/super-admin/agents', icon: Bot, requiredRole: 'admin' },
      { id: 'automations', label: 'Automations', href: '#', icon: Workflow, disabled: true, tooltip: 'Coming soon' },
    ],
  },
];
