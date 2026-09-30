/** `product-card` → `productCard` (same rule as Vue's `camelize`). */
export function camelize(value: string): string {
  return value.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
}

/** `product-card` / `productCard` → `ProductCard`. */
export function pascalize(value: string): string {
  const camel = camelize(value)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

/**
 * Display name derived from a file path, mirroring Vue's `__name` inference:
 * `src/components/ProductCard.vue` → `ProductCard`; `src/views/cart/index.vue` → `Cart`.
 */
export function componentNameFromFile(file: string): string {
  const parts = file.split(/[\\/]/)
  let base = (parts.at(-1) ?? file).replace(/\.vue$/i, '')
  if (base === 'index' && parts.length > 1) base = parts.at(-2) ?? base
  return pascalize(base.replace(/[^\w-]/g, '-'))
}
