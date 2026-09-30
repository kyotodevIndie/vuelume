export interface Product {
  id: number
  name: string
  price: number
  featured?: boolean
}

export interface BadgeProps {
  label: string
  tone?: 'info' | 'success' | 'danger'
}
