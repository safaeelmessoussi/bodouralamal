# Frontend Spacing & Layout Guide

## Spacing Scale

All spacing uses Tailwind's spacing scale with responsive prefixes:

| Value | Pixels | Usage |
|-------|--------|-------|
| xs | 8px (0.5rem) | Small gaps, icon spacing |
| sm | 12px (0.75rem) | Tight spacing, item gaps |
| md | 16px (1rem) | Default spacing, form gaps |
| lg | 24px (1.5rem) | Large gaps, section spacing |
| xl | 32px (2rem) | Extra large gaps |

## Responsive Breakpoints

```
Mobile: < 640px (default)
sm: 640px (mobile landscape)
md: 768px (tablet)
lg: 1024px (desktop)
xl: 1280px (wide desktop)
2xl: 1536px (ultra-wide)
```

## Layout Components

### PageLayout
Standard page with consistent padding across all breakpoints:
```tsx
<PageLayout>
  <PageHeader title="Title" />
  <GridLayout columns={2} gap="md">
    <Card>...</Card>
    <Card>...</Card>
  </GridLayout>
</PageLayout>
```

- Mobile: `p-4` (16px)
- Tablet: `p-5` (20px)  
- Desktop: `p-6` (24px)
- Wide: `p-8` (32px)

### GridLayout
Responsive grid with preset column and gap configurations:

**1 Column (default mobile):**
```tsx
<GridLayout columns={1} gap="md">
```

**2 Columns (responsive):**
```tsx
<GridLayout columns={2} gap="md">
// Mobile: 1 col
// Tablet+: 2 cols
```

**3 Columns (responsive):**
```tsx
<GridLayout columns={3} gap="md">
// Mobile: 1 col
// Tablet: 2 cols
// Desktop+: 3 cols
```

**4 Columns (responsive):**
```tsx
<GridLayout columns={4} gap="md">
// Mobile: 1 col
// Small: 2 cols
// Desktop+: 4 cols
```

### TwoColumnLayout
Primary + sidebar pattern:
```tsx
<TwoColumnLayout>
  <PrimaryColumn>Main content (2/3 width on desktop)</PrimaryColumn>
  <SidebarColumn>Sidebar content (1/3 width on desktop)</SidebarColumn>
</TwoColumnLayout>
```

### Stack
Consistent spacing between items:
```tsx
<Stack direction="vertical" gap="md">
  <Item />
  <Item />
</Stack>
```

### ResponsiveContainer
Max-width wrapper with consistent padding:
```tsx
<ResponsiveContainer size="lg" padding>
  Content
</ResponsiveContainer>
```

Sizes: `sm` (28rem), `md` (42rem), `lg` (56rem), `xl` (80rem), `full`

## Spacing Patterns

### Within Cards
```tsx
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent className="space-y-4">
    {items.map(item => <Item key={item.id} />)}
  </CardContent>
</Card>
```

Use `space-y-*` inside card content for consistent item spacing:
- `space-y-2`: Tight items (8px)
- `space-y-3`: Compact items (12px)
- `space-y-4`: Default items (16px)
- `space-y-6`: Loose items (24px)

### Between Sections
```tsx
<PageLayout>
  <PageHeader /> {/* Followed by default gap */}
  <GridLayout>...</GridLayout> {/* Next section */}
  <Card /> {/* Next section */}
</PageLayout>
```

PageLayout automatically adds `space-y-6` between sections.

### Form Elements
```tsx
<div className="space-y-4">
  <FormField />
  <FormField />
  <Button />
</div>
```

Standard form spacing: `space-y-4` (16px gap)

## Responsive Padding

Always use responsive padding instead of fixed values:

```tsx
// ✓ Good - responsive
className="p-4 sm:p-5 md:p-6 lg:p-8"

// ✗ Bad - fixed
className="p-6"
```

## Grid Patterns

### Stat Cards Grid
```tsx
<GridLayout columns={4} gap="md">
  <StatCard />
  <StatCard />
  <StatCard />
  <StatCard />
</GridLayout>
```

Automatically stacks:
- Mobile: 1 column
- Small devices: 2 columns (sm)
- Desktop: 4 columns (lg)

### Feature Cards Grid
```tsx
<GridLayout columns={3} gap="lg">
  <Card />
  <Card />
  <Card />
</GridLayout>
```

Automatically stacks:
- Mobile: 1 column
- Tablet: 2 columns (md)
- Desktop: 3 columns (lg)

## RTL Considerations

All layout components have built-in RTL support:

```tsx
// Automatically handles RTL
<PageLayout>Content</PageLayout>

// All grid layouts work with RTL
<GridLayout columns={2}>
  {/* Items automatically reverse in RTL */}
</GridLayout>
```

## Table Spacing

Use AccessibleTable for consistent table spacing:

```tsx
<AccessibleTable>
  <TableHead>
    <TableRow>
      <TableHeaderCell>Header</TableHeaderCell>
    </TableRow>
  </TableHead>
  <TableBody>
    <TableRow>
      <TableCell>Cell (p-4 py-3)</TableCell>
    </TableRow>
  </TableBody>
</AccessibleTable>
```

Default cell padding: `px-4 py-3` (16px horizontal, 12px vertical)

## Mobile-First Spacing

Always start with mobile spacing, then increase:

```tsx
// ✓ Good - mobile first
className="gap-3 sm:gap-4 md:gap-6"

// ✗ Bad - desktop focused
className="gap-6 md:gap-3"
```

## Common Spacing Combinations

### Page Section with Cards
```tsx
<PageLayout>
  <PageHeader />
  <GridLayout columns={2} gap="md">
    <Card className="space-y-4">
      <CardHeader />
      <CardContent className="space-y-3">
        Items
      </CardContent>
    </Card>
  </GridLayout>
</PageLayout>
```

### Dashboard Layout
```tsx
<PageLayout>
  <PageHeader />
  <StatsGrid /> {/* spacing handled internally */}
  <GridLayout columns={2} gap="lg">
    <TaskList />
    <ClassList />
  </GridLayout>
</PageLayout>
```

### Form Layout
```tsx
<PageLayout>
  <PageHeader />
  <ResponsiveContainer size="md">
    <Stack direction="col" gap="md">
      <FormField />
      <FormField />
      <Button />
    </Stack>
  </ResponsiveContainer>
</PageLayout>
```

## Accessibility with Spacing

Proper spacing improves accessibility:

- Minimum touch target: 44x44px (ensure `gap-4` minimum)
- Line height: 1.6 for body text
- Form labels: `space-y-2` above inputs
- Button groups: `gap-2` (8px between buttons)

## Performance Notes

Spacing components are optimized for:
- Zero layout shift (critical spacing defined)
- Minimal CSS output (uses Tailwind utilities)
- Responsive without bloat (mobile-first approach)
- RTL rendering (single component, no duplication)

## Migration Guide

### Old Pattern
```tsx
<div className="space-y-6 p-6">
  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
    <Card />
  </div>
</div>
```

### New Pattern
```tsx
<PageLayout>
  <GridLayout columns={2} gap="md">
    <Card />
  </GridLayout>
</PageLayout>
```

Benefits:
- Consistent spacing across app
- Responsive behavior guaranteed
- Easier to maintain
- Better accessibility
- Built-in RTL support
