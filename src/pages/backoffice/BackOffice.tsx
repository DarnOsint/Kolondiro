import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  Users,
  UtensilsCrossed,
  MapPin,
  LayoutGrid,
  Package,
  Truck,
  QrCode,
  Lock,
  ChefHat,
  Monitor,
  Printer,
  Map,
  ShoppingBag,
  Beer,
  Camera,
  Network,
  Music,
} from 'lucide-react'
import { HelpTooltip } from '../../components/HelpTooltip'
import StaffManagement from './StaffManagement'
import MenuManagement from './MenuManagement'
import ZonePricing from './ZonePricing'
import RavePricing from './RavePricing'
import POSMachines from './POSMachines'
import TableConfig from './TableConfig'
import Inventory from './Inventory'
import Suppliers from './Suppliers'
import ChangePassword from './ChangePassword'
import KitchenStock from './KitchenStock'
import PrinterConfig from './PrinterConfig'
import FloorPlan from './FloorPlan'
import TakeawayPacks from './TakeawayPacks'
import BarChillerStock from './BarChillerStock'
import CCTVConfig from './CCTVConfig'
import NetworkPrinters from './NetworkPrinters'
import { useNavigate } from 'react-router-dom'
import type { Role } from '../../types'

interface Section {
  id: string
  label: string
  desc: string
  icon: React.ElementType
  color: string
  roles: Role[]
}

export default function BackOffice() {
  const { profile, signOut } = useAuth()
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const _ms = document.getElementById('main-scroll')
    if (_ms) _ms.scrollTop = 0
  }, [activeSection])

  const sections: Section[] = [
    {
      id: 'staff',
      label: 'Staff Management',
      desc: 'Add, edit and manage staff roles and PINs',
      icon: Users,
      color: 'bg-blue-500',
      roles: ['owner', 'manager'],
    },
    {
      id: 'menu',
      label: 'Menu Management',
      desc: 'Add and edit menu items, prices, availability',
      icon: UtensilsCrossed,
      color: 'bg-green-500',
      roles: ['owner', 'manager'],
    },
    {
      id: 'zonepricing',
      label: 'Zone Pricing',
      desc: 'Set drink prices per zone',
      icon: MapPin,
      color: 'bg-purple-500',
      roles: ['owner', 'manager'],
    },
    {
      id: 'ravepricing',
      label: 'Rave Pricing',
      desc: 'Set prices that activate when Rave Mode is on',
      icon: Music,
      color: 'bg-pink-600',
      roles: ['owner', 'manager'],
    },
    {
      id: 'tables',
      label: 'Table Configuration',
      desc: 'Edit table names and capacity',
      icon: LayoutGrid,
      color: 'bg-amber-500',
      roles: ['owner', 'manager'],
    },
    {
      id: 'floorplan',
      label: 'Floor Plan',
      desc: 'Drag-and-drop table layout — arrange tables as they are on site',
      icon: Map,
      color: 'bg-emerald-600',
      roles: ['owner', 'manager'],
    },
    {
      id: 'inventory',
      label: 'Main Store',
      desc: 'Master stock levels, restocking, supplier logs — the big store',
      icon: Package,
      color: 'bg-blue-600',
      roles: ['owner', 'manager'],
    },
    {
      id: 'barchiller',
      label: 'Bar Chiller Stock',
      desc: 'Daily bar chiller register — what was received, sold, and remaining',
      icon: Beer,
      color: 'bg-cyan-600',
      roles: ['owner', 'manager', 'bar'],
    },
    {
      id: 'kitchenstock',
      label: 'Kitchen Stock Register',
      desc: 'Daily food received vs sold vs remaining — variance tracking',
      icon: ChefHat,
      color: 'bg-orange-600',
      roles: ['owner', 'manager', 'kitchen'],
    },
    {
      id: 'suppliers',
      label: 'Suppliers',
      desc: 'Manage suppliers and purchase orders',
      icon: Truck,
      color: 'bg-teal-600',
      roles: ['owner', 'manager'],
    },
    {
      id: 'takeawaypacks',
      label: 'Takeaway Pack Sizes',
      desc: 'Configure pack sizes and prices for takeaway orders',
      icon: ShoppingBag,
      color: 'bg-lime-600',
      roles: ['owner', 'manager'],
    },
    {
      id: 'qrcards',
      label: 'QR Zone Cards',
      desc: 'Print one QR code per zone (pricing only)',
      icon: QrCode,
      color: 'bg-rose-500',
      roles: ['owner', 'manager'],
    },
    {
      id: 'posmachines',
      label: 'POS Machines',
      desc: 'Name and manage your POS terminals for shift reconciliation',
      icon: Monitor,
      color: 'bg-cyan-500',
      roles: ['owner', 'manager'],
    },
    {
      id: 'cctvconfig',
      label: 'CCTV Config',
      desc: 'Configure cameras, zones, and AI detection settings',
      icon: Camera,
      color: 'bg-violet-600',
      roles: ['owner', 'manager'],
    },
    {
      id: 'networkprinters',
      label: 'Network Printers',
      desc: 'Configure all thermal printers on the network by IP and function',
      icon: Network,
      color: 'bg-indigo-600',
      roles: ['owner', 'manager'],
    },
    {
      id: 'printerconfig',
      label: 'Print Server',
      desc: 'Legacy print server URL configuration',
      icon: Printer,
      color: 'bg-indigo-500',
      roles: ['owner', 'manager'],
    },
    {
      id: 'changepassword',
      label: 'Change Password',
      desc: 'Update your account login password',
      icon: Lock,
      color: 'bg-gray-600',
      roles: [
        'owner',
        'manager',
        'accountant',
        'auditor',
        'kitchen',
        'bar',
        'griller',
        'apartment_manager',
      ],
    },
  ]

  void signOut // referenced to satisfy linter if profile is also unused

  if (!profile)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading...</div>
      </div>
    )

  const allowed = sections.filter((s) => s.roles.includes(profile.role as Role))

  if (activeSection === 'staff') return <StaffManagement onBack={() => setActiveSection(null)} />
  if (activeSection === 'menu') return <MenuManagement onBack={() => setActiveSection(null)} />
  if (activeSection === 'zonepricing') return <ZonePricing onBack={() => setActiveSection(null)} />
  if (activeSection === 'ravepricing') return <RavePricing onBack={() => setActiveSection(null)} />
  if (activeSection === 'tables') return <TableConfig onBack={() => setActiveSection(null)} />
  if (activeSection === 'floorplan') return <FloorPlan onBack={() => setActiveSection(null)} />
  if (activeSection === 'qrcards') {
    navigate('/backoffice/qr-cards')
    return null
  }
  if (activeSection === 'changepassword')
    return <ChangePassword onBack={() => setActiveSection(null)} />
  if (activeSection === 'posmachines') return <POSMachines onBack={() => setActiveSection(null)} />
  if (activeSection === 'kitchenstock')
    return <KitchenStock onBack={() => setActiveSection(null)} />
  if (activeSection === 'inventory') return <Inventory onBack={() => setActiveSection(null)} />
  if (activeSection === 'suppliers') return <Suppliers onBack={() => setActiveSection(null)} />
  if (activeSection === 'barchiller')
    return <BarChillerStock onBack={() => setActiveSection(null)} />
  if (activeSection === 'cctvconfig') return <CCTVConfig onBack={() => setActiveSection(null)} />
  if (activeSection === 'networkprinters')
    return <NetworkPrinters onBack={() => setActiveSection(null)} />
  if (activeSection === 'printerconfig')
    return <PrinterConfig onBack={() => setActiveSection(null)} />
  if (activeSection === 'takeawaypacks')
    return <TakeawayPacks onBack={() => setActiveSection(null)} />

  return (
    <div className="min-h-full bg-gray-950">
      <div className="p-6">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-white text-2xl font-bold">Back Office</h2>
            <p className="text-gray-400 mt-1">Manage your restaurant settings</p>
          </div>
          <HelpTooltip
            storageKey="backoffice"
            tips={[
              {
                id: 'bo-staff',
                title: 'Staff Management',
                description:
                  'Add and manage staff accounts. Assign each person a role (owner, manager, supervisor, accountant, waitron, kitchen, bar, griller) and a 4-digit PIN. A staff member cannot log in until they have an active account. Email + password login is available to owner, manager, and accountant roles; all other roles use PIN only.',
              },
              {
                id: 'bo-menu',
                title: 'Menu Management',
                description:
                  'Add, edit, or disable menu items. Each item must have a category and a destination — Kitchen, Bar, or Griller. The destination controls which KDS screen the order appears on. Items can be searched by name and filtered by category.',
              },
              {
                id: 'bo-zone',
                title: 'Zone Pricing',
                description:
                  'Set different drink prices for each zone: Outdoor, Indoor, VIP Lounge, and The Nook. Food is always fixed price. Zone prices are applied automatically at order time. Search items by name to find and edit them quickly.',
              },
              {
                id: 'bo-tables',
                title: 'Table Configuration',
                description:
                  'Edit table names and assign zones. The Zone Settings section below the table grid lets you set a hire fee per zone — useful for The Nook which is bookable as a private space. The hire fee is shown as a reminder banner in the POS when that zone is selected.',
              },
              {
                id: 'bo-floorplan',
                title: 'Floor Plan',
                description:
                  'Visual table layout editor. Drag tables to position them exactly as they are on site. Click a table to select it, then resize by dragging the corner handle or toggle between square and round shapes. Filter by zone to focus on specific areas. The layout is saved and can be used as a reference for staff.',
              },
              {
                id: 'bo-pos',
                title: 'POS Machines',
                description:
                  'Name and manage your physical POS terminals (e.g. POS-1, Counter, Bar Terminal). Once named, the manager can assign a specific machine to each waitron at clock-in. Every sale is then traceable to a terminal for end-of-shift reconciliation.',
              },
              {
                id: 'bo-inventory',
                title: 'Drink Inventory',
                description:
                  'Track stock levels for all drinks. Set a minimum threshold per item — when stock drops to or below that level, a low stock alert appears on the Executive Dashboard and the manager receives a push notification. Log manual restocks here.',
              },
              {
                id: 'bo-kitchenstock',
                title: 'Kitchen Stock Register',
                description:
                  'Daily food accountability: record what was received, auto-sync what was sold from POS, and calculate what should remain. Managers can set yield benchmarks per ingredient. Variance alarms flag waste or possible theft. Managers can edit entries; kitchen staff can only add.',
              },
              {
                id: 'bo-suppliers',
                title: 'Suppliers',
                description:
                  'Manage suppliers and raise purchase orders. Mark a delivery received to automatically add quantities to inventory. Search suppliers by name or contact to find them quickly.',
              },
              {
                id: 'bo-qr',
                title: 'QR Zone Cards',
                description:
                  'Generate and print one QR code per zone. Customers scan to check zone-based prices and rate service (thumbs up/down). Orders are placed through waitrons only.',
              },
            ]}
          />
        </div>

        {allowed.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">You do not have access to any back office sections.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
            {allowed.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className="bg-gray-900 border border-gray-800 hover:border-amber-500/50 rounded-2xl p-6 text-left flex items-start gap-4 transition-all group"
              >
                <div
                  className={`w-12 h-12 ${section.color} rounded-xl flex items-center justify-center shrink-0`}
                >
                  <section.icon size={22} className="text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold group-hover:text-amber-400 transition-colors">
                    {section.label}
                  </h3>
                  <p className="text-gray-500 text-sm mt-1">{section.desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
