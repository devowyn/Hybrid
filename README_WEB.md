# Route Calculator - Web Application

A full-stack web application for route calculation using Google Maps API and OpenStreetMap data with an interactive HTML interface.

## Features

- 🗺️ Interactive Google Maps interface
- 📍 Click-to-set start and end locations
- 🔵 Dijkstra algorithm route calculation
- 🚗 Google Maps API integration with real-time traffic
- 📊 Side-by-side route comparison
- 🎨 Beautiful, responsive UI

## Project Structure

```
routing-calculator/
├── server.js           # Express backend server
├── package.json        # Dependencies
├── public/
│   └── index.html     # Frontend interface
└── README.md
```

## Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)
- Google Maps API key with the following APIs enabled:
  - Maps JavaScript API
  - Directions API

## Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Set up Google Maps API key:**

You need to add your API key in TWO places:

**A. Backend (for Directions API):**

Set environment variable:

**Windows:**
```bash
set GOOGLE_MAPS_API_KEY=your_api_key_here
```

**Linux/Mac:**
```bash
export GOOGLE_MAPS_API_KEY=your_api_key_here
```

**B. Frontend (for Maps display):**

Edit `public/index.html` and replace `YOUR_GOOGLE_MAPS_API_KEY` on the last line:

```html
<script src="https://maps.googleapis.com/maps/api/js?key=YOUR_ACTUAL_API_KEY_HERE&callback=initMap" async defer></script>
```

## Usage

1. **Start the server:**
```bash
npm start
```

2. **Open your browser:**
Navigate to `http://localhost:3000`

3. **Use the interface:**
   - Click "📍 Set Start" then click on the map to set start location
   - Click "🎯 Set End" then click on the map to set end location
   - Or manually enter coordinates in the sidebar
   - Click "Calculate Route" to get results
   - View route comparison and interactive map

## How It Works

### Backend (server.js)
- Express.js server handles API requests
- Fetches road network from OpenStreetMap via Overpass API
- Builds graph and calculates routes using Dijkstra's algorithm
- Queries Google Maps Directions API for comparison
- Returns route data to frontend

### Frontend (index.html)
- Interactive Google Maps interface
- Click-to-place markers for start/end locations
- Sends route calculation requests to backend
- Displays results and draws route on map
- Responsive design for mobile and desktop

## API Endpoints

### POST `/api/calculate-route`

Calculate route between two points.

**Request body:**
```json
{
  "startLat": 16.42624764730844,
  "startLon": 120.59789698832675,
  "endLat": 16.42338973567086,
  "endLon": 120.60298773090588
}
```

**Response:**
```json
{
  "success": true,
  "dijkstra": {
    "distance": 2180.5,
    "distanceKm": "2.18",
    "nodes": 45,
    "coordinates": [[16.426, 120.598], ...]
  },
  "googleMaps": {
    "travelTime": 314,
    "distance": 2150,
    "travelTimeText": "5 mins",
    "distanceText": "2.2 km",
    "polyline": "encoded_polyline_string"
  }
}
```

## Features Explained

### Interactive Map
- Click on map to set start/end points
- Visual markers show selected locations
- Route is drawn on map after calculation

### Route Calculation
- Uses OpenStreetMap data for road network
- Dijkstra's algorithm finds optimal path
- Compares with Google Maps real-time route
- Shows distance, travel time, and traffic info

### Responsive Design
- Works on desktop and mobile
- Sidebar layout adapts to screen size
- Touch-friendly controls

## Configuration

### Change Server Port

Edit `server.js`:
```javascript
const PORT = process.env.PORT || 3000;
```

### Adjust Search Area

Edit the buffer size in `server.js`:
```javascript
const buffer = 0.02; // ~2km buffer (change as needed)
```

### Customize Map Style

Edit `index.html` in the `initMap()` function:
```javascript
map = new google.maps.Map(document.getElementById('map'), {
    center: defaultCenter,
    zoom: 14,
    mapTypeId: 'roadmap', // Change to 'satellite', 'hybrid', 'terrain'
    styles: [] // Add custom styles here
});
```

## Troubleshooting

### "Cannot GET /" error
- Make sure server.js is running
- Check that `public/` folder exists with index.html

### Map not loading
- Verify Google Maps API key is correct in index.html
- Check that Maps JavaScript API is enabled in Google Cloud Console
- Open browser console (F12) to see error messages

### "Failed to fetch OSM data" error
- Check internet connection
- Overpass API might be rate-limited, wait and try again
- Try reducing the buffer area

### Routes not matching
- Dijkstra uses OpenStreetMap data (may be outdated)
- Google Maps uses proprietary data and traffic info
- Differences are normal and expected

## Google Maps API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable these APIs:
   - Maps JavaScript API
   - Directions API
4. Create credentials (API key)
5. Add API key to your project (see Installation section)

## Development

Run with auto-reload on file changes:
```bash
npm run dev
```

## Dependencies

- **express**: Web server framework
- **cors**: Enable cross-origin requests
- **axios**: HTTP client for API requests
- **@turf/turf**: Geospatial calculations
- **node-dijkstra**: Dijkstra's algorithm
- **xml2js**: Parse KML/XML files
- **jsdom**: Parse HTML descriptions

## Future Enhancements

- [ ] Add A* algorithm option
- [ ] Multiple route alternatives
- [ ] Save/load favorite routes
- [ ] Export routes to GPX/KML
- [ ] Add traffic layer toggle
- [ ] Route optimization (multiple waypoints)
- [ ] Elevation profile
- [ ] Turn-by-turn directions

## License

MIT

## Support

For issues or questions, please check:
- Google Maps API documentation
- OpenStreetMap Overpass API docs
- Browser console for error messages
