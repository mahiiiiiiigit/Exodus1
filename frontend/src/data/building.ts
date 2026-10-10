export interface Floor {
  level: number
  label: string
  name: string
  area: string
  occupants: number
  exits: number
}

export const floors: Floor[] = [
  { level: 1, label: 'G', name: 'Ground floor', area: '1,240 m²', occupants: 42, exits: 4 },
  { level: 2, label: '02', name: 'Office floor', area: '980 m²', occupants: 31, exits: 2 },
  { level: 3, label: '03', name: 'Office floor', area: '980 m²', occupants: 28, exits: 2 },
  { level: 4, label: '04', name: 'Office floor', area: '980 m²', occupants: 36, exits: 2 },
  { level: 5, label: '05', name: 'Office floor', area: '980 m²', occupants: 29, exits: 2 },
  { level: 6, label: '06', name: 'Office floor', area: '980 m²', occupants: 24, exits: 2 },
  { level: 7, label: '07', name: 'Office floor', area: '980 m²', occupants: 33, exits: 2 },
  { level: 8, label: '08', name: 'Office floor', area: '980 m²', occupants: 27, exits: 2 },
  { level: 9, label: '09', name: 'Office floor', area: '980 m²', occupants: 30, exits: 2 },
]
