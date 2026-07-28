# Frontend Architecture - Reusable Components & Adapter Pattern

## Overview

The frontend has been refactored to follow the **DRY (Don't Repeat Yourself)** principle with composition-based architecture. All dashboard pages now use centralized data sources and reusable components, eliminating duplicate code and making the system easier to maintain and extend.

## Key Architectural Patterns

### 1. Adapter Layer for Backend Dependencies

**File**: `src/services/dashboard-adapter.ts`

The adapter pattern isolates all mock data and backend dependencies in one place:

```typescript
// Data providers (functions to call to get dashboard data)
- getStudentStats()           // Student dashboard metrics
- getParentStats()            // Parent dashboard metrics  
- getTeacherStats()           // Teacher dashboard metrics
- getAdminStats()             // Admin dashboard metrics
- getStudentTasks()           // Student task list
- getStudentClasses()         // Student class schedule
- getRecentRegistrations()    // Admin registration list
- getUpcomingEvents()         // Calendar/event list
```

**Benefits**:
- Single source of truth for all mock data
- TODO comments mark where real API endpoints should be added
- One file to update when switching from mock to real data
- Easy to trace data flow and dependencies

**Example Migration Path**:
```typescript
// Current implementation (mock)
export function getStudentStats(): DashboardStats {
  return {
    isLoading: false,
    metrics: [...]
  }
}

// Future implementation (real API)
export async function getStudentStats(): Promise<DashboardStats> {
  const response = await fetch('/api/dashboard/student');
  return response.json();
}
```

### 2. Reusable Dashboard Components

All dashboard components follow a consistent composition pattern.

#### StatsGrid Component
**File**: `src/components/dashboard/stats-grid.tsx`

Renders metric cards in a responsive grid layout. Used by all dashboards.

```typescript
<StatsGrid 
  metrics={stats.metrics}          // Array of StatMetric objects
  icons={iconArray}                 // Optional: icon for each metric
  isLoading={stats.isLoading}      // Shows skeleton loaders
  columns={4}                       // Grid columns: 2, 3, or 4
/>
```

**Used By**:
- Student Dashboard (4 columns)
- Parent Dashboard (4 columns)
- Teacher Dashboard (4 columns)
- Admin Dashboard (4 columns)

#### TaskList Component
**File**: `src/components/dashboard/task-list.tsx`

Displays tasks with priority badges and due dates.

```typescript
<TaskList 
  tasks={tasks}                    // Array of TaskItem objects
  title="Upcoming Tasks"           // Custom title (optional)
  emptyMessage="No tasks"          // Empty state message (optional)
/>
```

**Interface**:
```typescript
interface TaskItem {
  id: string
  title: string
  due: string
  priority: "high" | "medium" | "low"
}
```

#### ClassList Component
**File**: `src/components/dashboard/class-list.tsx`

Shows class/group information with instructor and schedule.

```typescript
<ClassList 
  classes={classes}                // Array of ClassItem objects
  title="My Classes"               // Custom title (optional)
  emptyMessage="No classes"        // Empty state message (optional)
/>
```

**Interface**:
```typescript
interface ClassItem {
  id: string
  name: string
  instructor: string
  days: string
  time: string
}
```

#### EventList Component
**File**: `src/components/dashboard/event-list.tsx`

Renders upcoming events with type-based color badges (exam, meeting, event).

```typescript
<EventList 
  events={events}                  // Array of UpcomingEvent objects
  title="Upcoming Events"          // Custom title (optional)
  emptyMessage="No events"         // Empty state message (optional)
/>
```

**Interface**:
```typescript
interface UpcomingEvent {
  id: string
  title: string
  date: string
  branch: string
  type: "exam" | "meeting" | "event"
}
```

#### RegistrationList Component
**File**: `src/components/dashboard/registration-list.tsx`

Displays recent user registrations with status badges (pending, approved, rejected).

```typescript
<RegistrationList 
  registrations={registrations}    // Array of RecentEvent objects
  title="Recent Registrations"     // Custom title (optional)
  emptyMessage="No registrations"  // Empty state message (optional)
/>
```

**Interface**:
```typescript
interface RecentEvent {
  id: string
  name: string
  type: string
  branch: string
  time: string
  status: "pending" | "approved" | "rejected"
}
```

## Dashboard Pages - Before vs After

### Student Dashboard

**Before**:
- 224 lines of code
- Hardcoded all stats, tasks, classes inline
- 85 lines duplicated rendering logic for tasks and classes
- No reusability across pages

**After**:
- 120 lines of code (~46% smaller)
- Uses: StatsGrid, TaskList, ClassList
- Clean, readable composition
- All data from adapter

**Code Example**:
```typescript
export default function StudentDashboard() {
  const stats = getStudentStats()
  const tasks = getStudentTasks()
  const classes = getStudentClasses()

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader title={ar.student.dashboard.title} />
      <StatsGrid metrics={stats.metrics} isLoading={stats.isLoading} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TaskList tasks={tasks} />
        <ClassList classes={classes} />
      </div>
      {/* Learning goals section */}
    </div>
  )
}
```

### Parent Dashboard

**Before**:
- 142 lines of code
- Mixed English and Arabic content
- Duplicate rendering logic for assessments and classes
- No composition

**After**:
- 75 lines of code (~47% smaller)
- Uses: StatsGrid
- Fully translated to Arabic
- Cleaner layout with composition

### Teacher Dashboard

**Before**:
- 180 lines of code
- Mixed English and Arabic
- Duplicate rendering logic for assignments and sessions

**After**:
- 95 lines of code (~47% smaller)
- Uses: StatsGrid
- Fully translated to Arabic
- Simpler composition

### Admin Dashboard

**Before**:
- 206 lines of code
- Duplicate event rendering logic
- Duplicate registration rendering logic
- Mixed inline rendering and components

**After**:
- 120 lines of code (~42% smaller)
- Uses: StatsGrid, EventList, RegistrationList
- Clean separation of concerns
- Data from adapter functions

## Data Flow Architecture

```
┌─────────────────────────────────────────┐
│    Dashboard Pages (Page Layer)         │
│  - student/dashboard.tsx                │
│  - parent/dashboard.tsx                 │
│  - teacher/dashboard.tsx                │
│  - admin/dashboard.tsx                  │
└──────────────┬──────────────────────────┘
               │ Import adapter functions
               │ & reusable components
               ▼
┌─────────────────────────────────────────┐
│    Reusable Components (UI Layer)       │
│  - StatsGrid                            │
│  - TaskList                             │
│  - ClassList                            │
│  - EventList                            │
│  - RegistrationList                     │
└──────────────┬──────────────────────────┘
               │ Receive data props
               │ & render UI
               │
└──────────────┬──────────────────────────┐
               ▼                          │
┌─────────────────────────────────────────┐
│    Dashboard Adapter (Data Layer)       │
│  dashboard-adapter.ts                   │
│                                         │
│  - getStudentStats()                    │
│  - getParentStats()                     │
│  - getTeacherStats()                    │
│  - getAdminStats()                      │
│  - getStudentTasks()                    │
│  - getStudentClasses()                  │
│  - getRecentRegistrations()             │
│  - getUpcomingEvents()                  │
└─────────────────────────────────────────┘
         │
         │ TODO: Replace mock with real API
         ▼
    (Future) Real API Calls
```

## Benefits of This Architecture

### 1. **DRY Principle**
- No duplicate mock data across pages
- No duplicate rendering logic
- Single source of truth for each data type

### 2. **Composition Over Duplication**
- Components are small and focused
- Easy to understand and maintain
- Can be reused across multiple pages

### 3. **Easy Backend Integration**
- All backend dependencies isolated in adapter
- TODO comments mark replacement points
- One place to add error handling and loading states
- Minimal changes needed to switch from mock to real data

### 4. **Consistent UI/UX**
- All dashboards use same components
- Consistent styling and behavior
- Easy to apply global updates

### 5. **Maintainability**
- Code is 40-50% smaller per page
- Clear data flow and dependencies
- Easy to locate and fix issues
- Easier to add new features

### 6. **Testability**
- Components accept data as props (easy to test with mock data)
- Adapter functions can be tested independently
- No tight coupling between pages and components

## Adding New Dashboard Components

To add a new reusable dashboard component:

1. **Create the component file**: `src/components/dashboard/your-component.tsx`
2. **Define the interface** for the data it receives
3. **Implement the component** with proper error handling and empty states
4. **Add data provider function** to `src/services/dashboard-adapter.ts`
5. **Use the component** in dashboard pages

Example:

```typescript
// src/components/dashboard/achievement-list.tsx
import { AchievementItem } from "@/services/dashboard-adapter"

interface AchievementListProps {
  achievements: AchievementItem[]
  title?: string
}

export default function AchievementList({ 
  achievements, 
  title = "Recent Achievements" 
}: AchievementListProps) {
  // Render achievements...
}
```

```typescript
// src/services/dashboard-adapter.ts
export function getStudentAchievements(): AchievementItem[] {
  return [
    // Mock data
  ]
}
```

```typescript
// src/pages/student/dashboard.tsx
import AchievementList from "@/components/dashboard/achievement-list"
import { getStudentAchievements } from "@/services/dashboard-adapter"

export default function StudentDashboard() {
  const achievements = getStudentAchievements()
  
  return (
    <AchievementList achievements={achievements} />
  )
}
```

## Migration Checklist for Backend Integration

When ready to integrate real backend:

- [ ] Create API endpoints matching dashboard-adapter interfaces
- [ ] Add environment variables for API URLs
- [ ] Update each adapter function to call real API
- [ ] Add error handling and retry logic
- [ ] Add loading states to components
- [ ] Test with real data
- [ ] Update TypeScript interfaces if API contracts differ
- [ ] Add caching layer if needed (e.g., React Query, SWR)

## Summary

This architecture provides:
- **Clean, maintainable code** through composition and DRY principles
- **Easy backend integration** with isolated adapter layer
- **Consistent UI** using reusable components
- **Reduced duplication** by 40-50% across dashboard pages
- **Clear separation of concerns** (data, UI, pages)
- **Future-proof design** that scales with new requirements
