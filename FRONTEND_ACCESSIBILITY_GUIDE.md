# Frontend Accessibility Guide

## Quick Checklist

### Keyboard Navigation
- [ ] All interactive elements are keyboard accessible
- [ ] Tab order is logical and visible
- [ ] Escape key closes modals/menus
- [ ] Enter/Space activates buttons
- [ ] Arrow keys navigate lists/menus

### Screen Reader Support
- [ ] All images have alt text (or are marked decorative)
- [ ] Form labels are associated with inputs
- [ ] Links have descriptive text
- [ ] Buttons have accessible names
- [ ] Lists use semantic `<ul>`, `<ol>`, `<li>`

### Visual Accessibility
- [ ] Color contrast ratio ≥ 4.5:1 for text
- [ ] Color not the only way to convey information
- [ ] Focus indicators are visible
- [ ] Text is resizable without breaking layout
- [ ] No flickering or auto-playing audio

### Responsive & Mobile
- [ ] Touch targets are ≥44x44 pixels
- [ ] Page is responsive at all breakpoints
- [ ] Works without JavaScript
- [ ] Works with mobile zoom
- [ ] Works with orientation changes

### RTL/Language Support
- [ ] Direction attributes set correctly
- [ ] All text translated
- [ ] Icons work in both directions
- [ ] No hardcoded left/right positioning

## Implementation Patterns

### Keyboard Navigation Hook

```tsx
import { useKeyboardNavigation, useFocusTrap } from "@/hooks/use-keyboard-navigation"

export function Modal() {
  const ref = useRef<HTMLDivElement>(null)
  
  // Trap focus inside modal
  useFocusTrap(ref)
  
  // Handle keyboard shortcuts
  useKeyboardNavigation(ref, {
    onEscape: onClose,
    onEnter: onConfirm,
  })
  
  return <div ref={ref} role="dialog">...</div>
}
```

### Accessible Table

```tsx
import { AccessibleTable, TableHead, TableBody, TableRow, TableCell } from "@/components/data-table/accessible-table"

<AccessibleTable caption="User registrations">
  <TableHead>
    <TableRow>
      <TableHeaderCell sortable sorted="asc">Name</TableHeaderCell>
      <TableHeaderCell>Email</TableHeaderCell>
    </TableRow>
  </TableHead>
  <TableBody>
    {users.map(user => (
      <TableRow key={user.id}>
        <TableCell>{user.name}</TableCell>
        <TableCell>{user.email}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</AccessibleTable>
```

### Form Accessibility

```tsx
<FormField
  id="email"
  name="email"
  label="البريد الإلكتروني"
  type="email"
  placeholder="example@example.com"
  error={errors.email}
  required
  aria-required="true"
/>
```

### Loading States

```tsx
import { LoadingOverlay } from "@/components/states/loading-overlay"

<LoadingOverlay 
  isLoading={isLoading}
  message="جاري التحميل..."
  aria-label="جاري تحميل البيانات"
>
  <Content />
</LoadingOverlay>
```

### Skip Navigation Link

```tsx
<a href="#main-content" className="sr-only">
  اذهب إلى المحتوى الرئيسي
</a>

<header>Navigation</header>
<main id="main-content">Content</main>
```

### Icon with Text

```tsx
import { Eye } from "lucide-react"

// ✓ Good - icon + text
<button>
  <Eye className="h-4 w-4 mr-2" />
  View Details
</button>

// ✗ Bad - icon only
<button title="View">
  <Eye className="h-4 w-4" />
</button>
```

### Accessible Alert

```tsx
<div 
  role="alert" 
  aria-live="polite"
  aria-atomic="true"
>
  تم حفظ التغييرات بنجاح
</div>
```

### Accessible Badge/Label

```tsx
<Badge 
  className="bg-red-100"
  aria-label="حالة عالية الأولوية"
>
  High
</Badge>
```

## ARIA Attributes

### Common Attributes

| Attribute | Usage | Example |
|-----------|-------|---------|
| `role` | Define element role | `role="button"` |
| `aria-label` | Accessible name | `aria-label="Close"` |
| `aria-labelledby` | Link to title | `aria-labelledby="dialog-title"` |
| `aria-describedby` | Link to description | `aria-describedby="help-text"` |
| `aria-required` | Mark required fields | `aria-required="true"` |
| `aria-invalid` | Mark invalid fields | `aria-invalid="true"` |
| `aria-live` | Announce updates | `aria-live="polite"` |
| `aria-busy` | Indicate loading | `aria-busy="true"` |
| `aria-hidden` | Hide from screen readers | `aria-hidden="true"` |
| `aria-expanded` | Indicate expanded state | `aria-expanded="false"` |
| `aria-selected` | Indicate selection | `aria-selected="true"` |

### Semantic HTML

```tsx
// ✓ Good - semantic
<nav>Navigation links</nav>
<main>Main content</main>
<header>Header content</header>
<footer>Footer content</footer>
<section>Section content</section>
<article>Article content</article>

// ✗ Bad - generic divs
<div role="navigation">Navigation links</div>
<div id="main">Main content</div>
```

## Testing Accessibility

### Manual Testing
1. Navigate page using only keyboard (Tab, Enter, Escape, Arrow keys)
2. Test with screen reader (NVDA, JAWS, VoiceOver)
3. Zoom page to 200% and verify layout
4. Check color contrast with tool
5. Disable CSS and verify content structure

### Automated Testing
```bash
# Run accessibility audit
npm run a11y:audit

# Test with axe DevTools
# Install browser extension: axe DevTools
```

### Browser DevTools
1. Chrome DevTools → Accessibility tab
2. Check computed accessibility tree
3. Review ARIA annotations
4. Look for contrast issues
5. Verify keyboard navigation

## Common Issues & Fixes

### Issue: Focus indicator not visible
```tsx
// ✓ Fix - ensure visible focus
button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
```

### Issue: Form label not connected
```tsx
// ✗ Bad
<label>Email</label>
<input type="email" />

// ✓ Good
<label htmlFor="email">Email</label>
<input id="email" type="email" />
```

### Issue: Button has no accessible name
```tsx
// ✗ Bad
<button><Trash className="h-4 w-4" /></button>

// ✓ Good
<button aria-label="حذف">
  <Trash className="h-4 w-4" />
</button>
```

### Issue: Image missing alt text
```tsx
// ✗ Bad
<img src="profile.jpg" />

// ✓ Good
<img src="profile.jpg" alt="صورة الملف الشخصي للمستخدم أحمد" />

// Or decorative
<img src="background.jpg" alt="" aria-hidden="true" />
```

### Issue: Modal not trappable with keyboard
```tsx
// ✓ Fix - use focus trap
export function Modal() {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  
  return <div ref={ref} role="dialog">...</div>
}
```

## Component-Specific Guidance

### Buttons
```tsx
<button
  type="button"
  disabled={isLoading}
  aria-busy={isLoading}
  aria-label="Save changes"
>
  {isLoading ? <Spinner /> : "Save"}
</button>
```

### Forms
```tsx
<form aria-label="User registration">
  <FormField
    label="Name"
    required
    aria-required="true"
    aria-describedby="name-help"
  />
  <small id="name-help">Your full legal name</small>
</form>
```

### Lists
```tsx
<ul role="list">
  {items.map(item => (
    <li key={item.id} role="listitem">
      {item.name}
    </li>
  ))}
</ul>
```

### Dropdowns/Menus
```tsx
<button
  aria-haspopup="menu"
  aria-expanded={open}
  onClick={() => setOpen(!open)}
>
  Menu
</button>
{open && (
  <ul role="menu">
    {options.map(option => (
      <li key={option.id} role="menuitem">
        {option.label}
      </li>
    ))}
  </ul>
)}
```

### Modals/Dialogs
```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="dialog-title"
  aria-describedby="dialog-description"
>
  <h2 id="dialog-title">Confirm Action</h2>
  <p id="dialog-description">Are you sure?</p>
</div>
```

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM](https://webaim.org/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [Deque University](https://dequeuniversity.com/)

## Compliance Standards

- **WCAG 2.1 Level AA**: Industry standard for accessibility
- **Section 508**: US federal accessibility requirement
- **ADA**: Americans with Disabilities Act
- **AODA**: Accessibility for Ontarians with Disabilities Act

## Next Steps

1. Run accessibility audit on all pages
2. Fix critical issues (keyboard navigation, alt text)
3. Implement accessibility testing in CI/CD
4. Train team on accessibility best practices
5. Regular audits and improvements
