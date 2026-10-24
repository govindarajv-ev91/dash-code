import { memo, useState } from 'react'
import {
  Activity, AlertTriangle, BarChart3, Bike, Briefcase, ChevronDown,
  CircleDollarSign, ClipboardList, Database, FileBarChart2, Folder,
  FolderOpen, History, IdCard, Layers, Leaf, Link2, Mail, MapPin,
  Package, PieChart, Radio, Search, Shield, Table2, TrendingDown,
  Truck, UserPlus, Users, UserX, Wallet, Wrench,
} from 'lucide-react'

const NAVIGATION_GROUPS = [
  {
    id: 'order', label: 'Order', pages: [
      { id: 'orderupload', label: 'Order Upload', icon: Package },
      { id: 'orderhistory', label: 'Order History', icon: ClipboardList, green: true },
    ],
  },
  {
    id: 'payment', label: 'Payment', pages: [
      { id: 'paymentupload', label: 'Payment Upload', icon: Wallet },
      { id: 'deployedrental', label: 'Deployed Rental', icon: CircleDollarSign, green: true },
      { id: 'paymenthistory', label: 'Payment History', icon: History },
      { id: 'sdpayment', label: 'SD & EV Rent', icon: Shield },
    ],
  },
  {
    id: 'supply', label: 'Supply', pages: [
      { id: 'ev91-summary', label: 'City / Client Summary', icon: Briefcase },
      { id: 'ev91-performance', label: 'Rider Performance', icon: Activity },
      { id: 'ev91-insight', label: 'Rider-Vehicle Monitor', icon: Users },
      { id: 'fulldata', label: 'Full Data', icon: Table2, green: true },
      { id: 'ev91-client-period-trend', label: 'Client Period Trend', icon: Table2 },
      { id: 'ev91-sources', label: 'Source List', icon: Users },
    ],
  },
  {
    id: 'reports', label: 'Reports', pages: [
      { id: 'ev91-evlookup', label: 'EV / NON-EV Lookup', icon: Search },
      { id: 'iotdata', label: 'IoT Data', icon: Radio, green: true },
      { id: 'sourcewise', label: 'Source Wise Data', icon: Users, green: true },
      { id: 'ev91-onboarding', label: 'Onboarding Pending', icon: UserPlus },
      { id: 'ev91-fl-pending', label: 'FL Pending', icon: ClipboardList },
    ],
  },
  {
    id: 'iot', label: 'IoT', pages: [
      { id: 'evimpact', label: 'CO2 & Savings', icon: Leaf, green: true },
      { id: 'ev91-iotupload', label: 'IoT Data Upload', icon: Radio },
    ],
  },
  {
    id: 'other', label: 'Other', pages: [
      { id: 'attendance', label: 'Rider Attendance', icon: ClipboardList },
      { id: 'tracking', label: 'Vehicle Tracking', icon: Truck, green: true },
      { id: 'riderperformance', label: 'Rider Performance', icon: Activity, green: true },
      { id: 'onboarding', label: 'Onboarding Analytics', icon: UserPlus },
      { id: 'errorfinder', label: 'Error Finder', icon: AlertTriangle },
      { id: 'dailymailer', label: 'Daily Mailer', icon: Mail },
      { id: 'tempparser', label: 'Temp Parser', icon: FileBarChart2 },
      { id: 'riderdetails', label: 'Rider Details', icon: Users, green: true },
      { id: 'inactivemailer', label: 'Inactive Mailer', icon: UserX },
      { id: 'attritionmailer', label: 'Rider Attrition', icon: TrendingDown },
    ],
  },
  {
    id: 'old-data', label: "Old Data's", pages: [
      { id: 'fleetdata', label: 'Fleet Data', icon: Database },
      { id: 'fleetcitysummary', label: 'Fleet Summary', icon: MapPin, green: true },
      { id: 'serviceschedule', label: 'Service Schedule', icon: Wrench, green: true },
      { id: 'fleetsummary', label: 'Client Summary', icon: PieChart },
      { id: 'bigquery', label: 'BigQuery Data', icon: Layers, green: true },
    ],
  },
  {
    id: 'ev91-api', label: 'EV91 API', pages: [
      { id: 'ev91-riders', label: 'Rider Details', icon: IdCard },
      { id: 'ev91-vehicles', label: 'Vehicles', icon: Bike },
      { id: 'ev91-sd', label: 'EV91 SD', icon: Shield },
      { id: 'ev91-operational', label: 'Operational Status', icon: Wrench },
      { id: 'ev91-current', label: 'Current Status', icon: Bike },
      { id: 'ev91-overall', label: 'Overall Status', icon: Layers },
      { id: 'ev91-mapping', label: 'Client Mapping', icon: Link2 },
    ],
  },
]

const NavigationFolder = memo(function NavigationFolder({ group, activePage, onSelectPage, onIotUpload }) {
  const containsActivePage = group.pages.some((page) => page.id === activePage)
  const [expanded, setExpanded] = useState(containsActivePage)
  const childrenId = `nav-folder-${group.id}`

  return (
    <div className={`nav-folder ${expanded ? 'open' : ''}`}>
      <button
        type="button"
        className={`nav-item nav-folder-toggle ${containsActivePage ? 'folder-active' : ''}`}
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={childrenId}
      >
        {expanded ? <FolderOpen size={20} /> : <Folder size={20} />}
        <span className="nav-folder-label">{group.label}</span>
        <ChevronDown size={16} className="nav-folder-chevron" />
      </button>
      <div id={childrenId} className="nav-folder-children" hidden={!expanded}>
        {expanded && group.pages.map(({ id, label, icon, green }) => (
          <button
            key={id}
            type="button"
            className={`nav-item nav-item-child${green ? ' nav-item-green' : ''}${activePage === id ? ' active' : ''}`}
            aria-current={activePage === id ? 'page' : undefined}
            onClick={() => id === 'ev91-iotupload' ? onIotUpload() : onSelectPage(id)}
          >
            <PageIcon icon={icon} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
})

function PageIcon({ icon }) {
  const Icon = icon
  return <Icon size={18} />
}

const SidebarNavigation = memo(function SidebarNavigation({ activePage, onSelectPage, onIotUpload, isAdmin }) {
  return (
    <nav className="nav-links" aria-label="Main navigation">
      {isAdmin && <a className="nav-item" href="#admin"><Shield size={20} />Sign-in settings</a>}
      <button
        type="button"
        className={`nav-item nav-item-green ${activePage === 'dashboard' ? 'active' : ''}`}
        aria-current={activePage === 'dashboard' ? 'page' : undefined}
        onClick={() => onSelectPage('dashboard')}
      >
        <BarChart3 size={20} />
        Dashboard
      </button>
      {NAVIGATION_GROUPS.map((group) => (
        <NavigationFolder
          key={group.id}
          group={group}
          activePage={group.pages.some((page) => page.id === activePage) ? activePage : null}
          onSelectPage={onSelectPage}
          onIotUpload={onIotUpload}
        />
      ))}
    </nav>
  )
})

export default SidebarNavigation
