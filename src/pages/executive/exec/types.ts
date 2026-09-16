export interface Stats {
  revenue: number
  openOrders: number
  occupiedTables: number
  totalTables: number
  staffOnDuty: number
  lowStock: number
}

export interface TrendDay {
  day: string
  revenue: number
  orders: number
}
