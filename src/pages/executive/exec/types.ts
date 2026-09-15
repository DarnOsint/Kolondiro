export interface Stats {
  revenue: number
  openOrders: number
  occupiedTables: number
  totalTables: number
  occupiedRooms: number
  totalRooms: number
  staffOnDuty: number
  lowStock: number
}

export interface TrendDay {
  day: string
  revenue: number
  orders: number
}

export interface CvData {
  occupancy: number
  todayAlerts: Record<string, unknown>[]
  zoneHeatmaps: Record<string, unknown>[]
  tillEvents: Record<string, unknown>[]
  shelfAlerts: Record<string, unknown>[]
}
