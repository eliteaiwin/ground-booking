# Testing Turf Booking App

## Overview
Turf Booking is a React (Vite) frontend + FastAPI backend app for sports ground booking and game organization. The frontend uses Capacitor for Android/iOS wrapping.

## Environment Setup

### Backend
```bash
cd sports-booking-backend
# Fresh DB with seed data:
rm -f ./app.db && SEED_MODE=production DATABASE_PATH=./app.db poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000
```
- Backend runs on `http://localhost:8000`
- SQLite database at `./app.db` (local dev) or `/data/app.db` (deployed)
- Uploads at `./uploads` (local dev) or `/data/uploads` (deployed)

### Frontend
```bash
cd sports-booking-frontend
npm run dev
```
- Frontend runs on `http://localhost:5173`
- Vite dev server with HMR

### Port Conflicts
If port 8000 is already in use, kill the process:
```bash
fuser -k 8000/tcp
```
Note: `lsof` may not be available on all systems; use `fuser` as a reliable alternative.

## Test Credentials

All accounts use password: `password123`

### Admin Users
| Name | Phone | Email | Roles |
|------|-------|-------|-------|
| Tittle Joseph | 9900000001 | tittlejoseph@gmail.com | admin, ground_management, moderator, user |
| Elite Dev | 9900000002 | elitedevlit@gmail.com | admin, ground_management, moderator, user |

### Test Users (20 total, phone range 9900000101-9900000120)
| Name | Phone | Sports |
|------|-------|--------|
| Rahul Sharma | 9900000101 | Soccer, Cricket |
| Priya Patel | 9900000102 | Badminton, Cricket |
| ... (18 more users) | 9900000103-9900000120 | Various |

### Test Location & Ground
- Location: Bangalore
- Ground: Whitefield United (ID 1)

## Devin Secrets Needed
No external secrets required for local testing. All test accounts are seeded automatically with `SEED_MODE=production`.

## Role-Based Testing

The app has 5 roles with different UI themes:
- **Admin** (maroon theme): Full access — Users, Preferences, Locations, Admin panel, Ground Mgmt, etc.
- **Ground Management** (orange/amber theme): Ground schedule, join requests, moderators, photos, blocked users
- **Moderator** (blue theme): Game organization, ground-specific management
- **User** (green theme): Basic features — Payments, Hall of Fame, Alert Settings, Grounds, Find Games
- **User Read-Only**: Restricted view

### Switching Roles
Admin users can switch between roles via: **Profile dropdown (top-right avatar) → Switch Role → select role**. The dashboard buttons and theme color change based on the active role.

## Key Navigation Paths

### Admin User Management
Dashboard (Admin role) → "Users" button → Admin User Management page
- Search/filter by name, phone, email, location, ground, role, sport
- Actions: Edit, Reset Password, Ground Roles, Disable/Enable
- Super-admins (tittlejoseph/elitedevlit) have no Disable button

### Ground Management → Blocked Tab
Dashboard (Admin/Ground Mgmt role) → "Ground Mgmt" button → Select ground → "Blocked" tab
- Search users to block, enter reason
- View blocked users list with reason, blocker name, date
- Unblock button to remove blocks

### Disable/Enable User Flow
1. Admin role → Users → Search for user → Click Ban icon
2. Confirmation modal with optional reason
3. Disabled user shows red "Disabled" badge + reason
4. Disabled user cannot login (403 error with reason)
5. Click green CheckCircle to re-enable

### Block/Unblock User per Ground Flow
1. Admin/Moderator role → Ground Mgmt → Select ground → Blocked tab
2. Search user in "Block a User" search box
3. Click user → Confirmation modal shows user + ground name
4. Enter reason → Block User
5. User appears in blocked list with details
6. Click Unblock to remove

## Testing Tips

- Always start with a fresh database (`rm -f ./app.db`) to ensure clean state
- The admin user defaults to "User" role view on login — switch to Admin role to access admin features
- Click timeouts on buttons are common with Playwright — the action usually succeeds even if the click reports a timeout (check the resulting page state)
- Use the search filter in Manage Users to quickly find specific users instead of scrolling
- The Blocked tab count badge updates in real-time after block/unblock actions
- Backend API docs available at `http://localhost:8000/docs` (FastAPI Swagger UI)
