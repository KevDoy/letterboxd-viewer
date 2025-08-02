<img src="https://raw.githubusercontent.com/KevDoy/letterboxd-viewer/refs/heads/main/favicon.png" height="70" alt>

# Letterboxd Export Viewer

A self-hosted, static web application for viewing your exported Letterboxd data with movie posters from The Movie Database (TMDB).

## Features

- 📊 **Dashboard** - Overview of your viewing statistics and recent activity with interactive charts
- 📔 **Diary** - Browse all your logged films with ratings, dates, and tags
- �️ **Watched** - View all watched films with advanced filtering by star rating (5★, 4.5★, 4★, etc.)
- �🔖 **Watchlist** - View films you want to watch
- ⭐ **Reviews** - Read through all your written reviews
- 📝 **Lists** - Browse your custom movie lists with detailed viewer
- 📈 **Interactive Statistics** - Visual charts with clickable elements to filter and explore your data
- 🎯 **Smart Filtering** - Click on rating distribution chart segments to instantly filter watched films
- 🎬 **Movie Posters** - Automatically fetches high-quality posters from TMDB (with TV/miniseries fallback)
- 📱 **Mobile-First Responsive Design** - Optimized layouts for desktop, tablet, and mobile devices
- 🌙 **Always-On Dark Mode** - Enhanced dark theme with Letterboxd color scheme
- 👥 **Multi-User Support** - View data from multiple Letterboxd exports (optional)
- 🔧 **Single User Mode** - Automatic fallback when no users.json is present

## Screenshots
![screenshot](https://raw.githubusercontent.com/KevDoy/letterboxd-viewer/refs/heads/screenshots/screenshots/screenshot-dashboard.jpeg "Dashboard Screenshot")
![screenshot](https://raw.githubusercontent.com/KevDoy/letterboxd-viewer/refs/heads/screenshots/screenshots/screenshot-diary.jpeg "Diary Screenshot")
![screenshot](https://raw.githubusercontent.com/KevDoy/letterboxd-viewer/refs/heads/screenshots/screenshots/screenshot-list.jpeg "List Screenshot")
![screenshot](https://raw.githubusercontent.com/KevDoy/letterboxd-viewer/refs/heads/screenshots/screenshots/screenshot-user-select.jpeg "Select User Screenshot")


## Setup Instructions

### Quick Setup (Single User)

The easiest way to get started:

1. Download or clone this repository
2. Extract your Letterboxd export ZIP file
3. Copy all the CSV files directly into the `letterboxd-export/` folder
4. The structure should look like:
   ```
   letterboxd-viewer/
   ├── index.html
   ├── app.js
   ├── style.css
   ├── README.md
   └── letterboxd-export/
       ├── diary.csv
       ├── watched.csv
       ├── ratings.csv
       ├── reviews.csv
       ├── watchlist.csv
       ├── profile.csv
       ├── comments.csv
       ├── lists/
       ├── likes/
       ├── deleted/
       └── orphaned/
   ```
5. Open the application in a web browser (see [Run the Application](#4-run-the-application))

### Advanced Setup (Multi-User Support)

For viewing multiple users' data:

1. Extract each user's Letterboxd export into separate folders within `letterboxd-export/`
2. Create `letterboxd-export/users.json` with your user configuration:

```json
[
  {
    "id": "user1",
    "displayName": "John Doe",
    "folder": "JohnDoe",
    "lastUpdated": "2024-01-15",
    "lists": [
      { "name": "2023 Favorites", "file": "2023-favorites.csv" },
      { "name": "Watchlist", "file": "my-watchlist.csv" }
    ]
  },
  {
    "id": "user2", 
    "displayName": "Jane Smith",
    "folder": "JaneSmith",
    "lastUpdated": "2024-01-10",
    "lists": [
      { "name": "Horror Films", "file": "horror-collection.csv" }
    ]
  }
]
```

3. The structure should look like:
   ```
   letterboxed-viewer/
   ├── index.html
   ├── app.js
   ├── style.css
   ├── README.md
   └── letterboxd-export/
       ├── users.json
       ├── JohnDoe/
       │   ├── diary.csv
       │   ├── watched.csv
       │   ├── (... all CSV files)
       │   └── lists/
       └── JaneSmith/
           ├── diary.csv
           ├── (... all CSV files)
           └── lists/
   ```

## How It Works

The app automatically detects your setup mode:

- **Single User Mode**: If no `users.json` file is found, the app expects your Letterboxd export data to be placed directly in the `letterboxd-export/` folder. Perfect for personal use.

- **Multi-User Mode**: If a `users.json` file is present, the app will show a user selection screen and load data from user-specific folders as configured.

### 3. Get TMDB API Key (Optional but Recommended)

To display movie posters, you'll need a free API key from The Movie Database:

1. Sign up at [TMDB](https://www.themoviedb.org/signup)
2. Go to [API Settings](https://www.themoviedb.org/settings/api)
3. Create a new API key (choose "Developer" option)
4. Copy your API key
5. Open `app.js` and replace the placeholder API key with your actual API key:
   ```javascript
   this.TMDB_API_KEY = 'your_actual_api_key_here';
   ```

**Note**: The app will search for both movies and TV shows/miniseries when looking up titles, providing better poster coverage for all types of content.

### 4. Deploy or Run the Application

This is a completely static web application that can be self-hosted on any web server or run locally.

#### Option A: Using Python (Recommended for Local Development)
```bash
# Navigate to the project directory
cd letterboxd-viewer

# Python 3
python -m http.server 8000

# Python 2
python -M SimpleHTTPServer 8000
```

Then open http://localhost:8000 in your browser.

#### Option B: Using Node.js (Local Development)
```bash
# Install a simple HTTP server
npm install -g http-server

# Navigate to project directory and run
cd letterboxd-viewer
http-server

# Or use npx (no installation required)
npx http-server
```

#### Option C: Using Live Server (VS Code)
1. Install the "Live Server" extension in VS Code
2. Right-click on `index.html`
3. Select "Open with Live Server"

#### Option D: Self-Hosting on Web Servers
The application is compatible with any static web hosting service, including:
- **Your own web server** (Apache, Nginx, etc.)
- **GitHub Pages** (though not recommended due to API key exposure)
- **Netlify** (private repos recommended)
- **Vercel** (private repos recommended)
- **Surge.sh**
- **Any hosting with file upload**

**Security Note**: If using public hosting services, be aware that your TMDB API key will be visible in the source code. For public hosting, consider using private repositories or removing the API key (app will work without posters).

**Note**: The app needs to be served over HTTP/HTTPS (not opened as local files) due to CORS restrictions when loading CSV files.

## Supported CSV Files

The application automatically loads and processes these standard Letterboxd export files:

### Core Files (Standard for all users)
- `diary.csv` - Your film diary with ratings, dates, tags
- `watched.csv` - Simple list of all watched films  
- `ratings.csv` - Films you've rated
- `reviews.csv` - Your written reviews
- `watchlist.csv` - Films you want to watch
- `profile.csv` - Your profile information
- `comments.csv` - Comments you've made

### Dynamic Folders (Varies by user)
- `lists/` - Your custom movie lists
- `likes/` - Films, reviews, and lists you've liked
- `deleted/` - Deleted content
- `orphaned/` - Orphaned content

## Customization

### Styling
The application uses Bootstrap 5 for the base styling with custom CSS in `style.css`. You can modify colors, fonts, and layout by editing this file.

### Adding Features
The application is built with vanilla JavaScript and has a modular structure. Key areas for customization:

- **Data Processing**: Modify the `processData()` method to add new data relationships
- **Views**: Add new sections by creating corresponding HTML and JavaScript methods
- **TMDB Integration**: Extend the `getTMDBData()` method to fetch additional movie information
- **Statistics**: Add new charts and metrics in the `renderStats()` method

### Configuration
You can modify these settings in `app.js`:
- **TMDB API Key**: Replace the placeholder value with your actual TMDB API key
- **Display Limits**: Currently set to 50 items per page for optimal performance
- **Dark Mode**: Automatically follows system preference with enhanced contrast and accessibility
- **TMDB Integration**: Searches both movies and TV shows for comprehensive poster coverage

## Troubleshooting

### No movie posters showing
- Make sure you've added your TMDB API key to `app.js`
- Check the browser console for API errors
- Verify your internet connection
- Note: The app searches both movies and TV shows, so most content should have posters

### CSV files not loading
- Ensure the `letterboxd-export` folder is in the correct location
- Make sure you're accessing the site through a web server (not file://)
- Check that CSV files aren't corrupted

### Application not loading
- Check the browser console for JavaScript errors
- Ensure all files are present and properly named
- Try refreshing the page or clearing browser cache

## Browser Compatibility

- Chrome/Chromium 70+
- Firefox 65+
- Safari 12+
- Edge 79+

## Privacy

This application runs entirely in your browser. Your Letterboxd data never leaves your device except for TMDB API calls to fetch movie posters (when API key is configured). No personal data is transmitted or stored on any external servers. When hosted on GitHub Pages or other static hosting, your CSV data remains completely private.

## Contributing

Feel free to contribute improvements! Some ideas:
- Additional chart types and interactive statistics
- Enhanced mobile navigation and user experience
- Export functionality for processed data
- Better TMDB matching for international titles
- Additional accessibility improvements
- Performance optimizations for large datasets
- More advanced filtering and search capabilities

## License

MIT License - feel free to use and modify as needed.

## Acknowledgments

- [Letterboxd](https://letterboxd.com) for the amazing platform and data export feature
- [The Movie Database (TMDB)](https://www.themoviedb.org) for movie metadata and posters
- [Bootstrap](https://getbootstrap.com) for the UI framework
- [Chart.js](https://www.chartjs.org) for statistics visualization
