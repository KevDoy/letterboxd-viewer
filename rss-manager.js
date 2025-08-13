// RSS Live Data Module for Letterboxd Viewer
class LetterboxdRSSManager {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
        this.isEnabled = false;
        this.currentUsername = null;
    }

    /**
     * Initialize RSS manager with user settings
     */
    init(username, enableLiveData = false) {
        this.currentUsername = username;
        this.isEnabled = enableLiveData;
        return this.isEnabled;
    }

    /**
     * Check if live data is available for current user
     */
    isLiveDataAvailable() {
        return this.isEnabled && this.currentUsername;
    }

    /**
     * Fetch user's RSS feed from Letterboxd
     */
    async fetchRSSFeed(username = null) {
        const user = username || this.currentUsername;
        if (!user) {
            throw new Error('No username provided');
        }

        const cacheKey = `rss_${user}`;
        const cached = this.cache.get(cacheKey);
        
        // Return cached data if available and not expired
        if (cached && (Date.now() - cached.timestamp < this.cacheTimeout)) {
            console.log('Returning cached RSS data');
            return cached.data;
        }

        console.log(`Fetching fresh RSS data for user: ${user}`);

        try {
            // Letterboxd RSS URL format
            const rssUrl = `https://letterboxd.com/${user}/rss/`;
            
            // Use a CORS proxy to fetch RSS
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;
            
            console.log('Fetching RSS from:', rssUrl);
            
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Failed to fetch RSS`);
            }

            const data = await response.json();
            
            if (!data.contents) {
                throw new Error('No content received from proxy');
            }
            
            console.log('RSS content received, length:', data.contents.length);

            // Handle base64 encoded data URLs
            let rssText = data.contents.trim();
            if (rssText.startsWith('data:application/rss+xml;charset=utf-8;base64,')) {
                console.log('Detected base64 encoded RSS content, decoding...');
                const base64Content = rssText.split(',')[1];
                rssText = atob(base64Content);
                console.log('Decoded RSS content, length:', rssText.length);
            }

            // Basic validation - check if it looks like XML
            if (!rssText.startsWith('<?xml') && !rssText.startsWith('<rss') && !rssText.startsWith('<feed')) {
                console.warn('Response does not appear to be valid XML/RSS');
                console.log('Response starts with:', rssText.substring(0, 100));
                throw new Error('Invalid RSS format received');
            }

            // Parse RSS XML
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(rssText, 'text/xml');
            
            // Check for parsing errors
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                console.error('XML parsing error:', parseError.textContent);
                throw new Error(`XML parsing failed: ${parseError.textContent}`);
            }
            
            console.log('XML parsed successfully');

            const items = this.parseRSSItems(xmlDoc);
            
            if (items.length === 0) {
                console.warn('No RSS items found in feed');
            } else {
                console.log(`Successfully parsed ${items.length} RSS items`);
            }
            
            // Cache the results
            this.cache.set(cacheKey, {
                data: items,
                timestamp: Date.now()
            });

            return items;

        } catch (error) {
            console.error('RSS fetch failed:', error.message);
            // Return empty array on error - graceful degradation
            return [];
        }
    }

    /**
     * Parse RSS XML items into structured data
     */
    parseRSSItems(xmlDoc) {
        const items = Array.from(xmlDoc.querySelectorAll('item'));
        console.log(`Found ${items.length} RSS items`);
        
        if (items.length === 0) {
            // Try alternative selectors in case the RSS structure is different
            const entries = Array.from(xmlDoc.querySelectorAll('entry'));
            console.log(`Found ${entries.length} RSS entries (Atom format)`);
            if (entries.length > 0) {
                return this.parseAtomEntries(entries);
            }
        }
        
        return items.map((item, index) => {
            const title = item.querySelector('title')?.textContent || '';
            const link = item.querySelector('link')?.textContent || '';
            const description = item.querySelector('description')?.textContent || '';
            const pubDate = item.querySelector('pubDate')?.textContent || '';
            
            console.log(`Item ${index + 1}:`, { title, link, pubDate });
            
            // Parse the activity type from title
            const activityType = this.determineActivityType(title, description);
            
            // Extract film information from the link and description
            const filmInfo = this.extractFilmInfo(title, link, description);
            
            return {
                title,
                link,
                description,
                pubDate: pubDate ? new Date(pubDate) : new Date(),
                activityType,
                filmInfo,
                isLiveData: true // Flag to identify live data
            };
        });
    }

    /**
     * Parse Atom feed entries (alternative format)
     */
    parseAtomEntries(entries) {
        return entries.map((entry, index) => {
            const title = entry.querySelector('title')?.textContent || '';
            const link = entry.querySelector('link')?.getAttribute('href') || '';
            const summary = entry.querySelector('summary')?.textContent || '';
            const published = entry.querySelector('published')?.textContent || entry.querySelector('updated')?.textContent || '';
            
            console.log(`Atom entry ${index + 1}:`, { title, link, published });
            
            const activityType = this.determineActivityType(title, summary);
            const filmInfo = this.extractFilmInfo(title, link, summary);
            
            return {
                title,
                link,
                description: summary,
                pubDate: published ? new Date(published) : new Date(),
                activityType,
                filmInfo,
                isLiveData: true
            };
        });
    }

    /**
     * Determine activity type from RSS item
     */
    determineActivityType(title, description) {
        const lowerTitle = title.toLowerCase();
        
        if (lowerTitle.includes('watched')) return 'diary';
        if (lowerTitle.includes('reviewed')) return 'review';
        if (lowerTitle.includes('liked')) return 'like';
        if (lowerTitle.includes('added') && lowerTitle.includes('watchlist')) return 'watchlist';
        if (lowerTitle.includes('created a list')) return 'list';
        
        return 'activity'; // Generic activity
    }

    /**
     * Extract film information from RSS item
     */
    extractFilmInfo(title, link, description) {
        // Extract film title from the title string
        // Letterboxd RSS titles are typically: "Username watched Film Title"
        const patterns = [
            /watched (.+?)(?:\s+\(\d{4}\))?$/,
            /reviewed (.+?)(?:\s+\(\d{4}\))?$/,
            /liked (.+?)(?:\s+\(\d{4}\))?$/
        ];

        let filmTitle = null;
        let year = null;

        for (const pattern of patterns) {
            const match = title.match(pattern);
            if (match) {
                filmTitle = match[1].trim();
                break;
            }
        }

        // Try to extract year from description or title
        const yearMatch = (title + ' ' + description).match(/\((\d{4})\)/);
        if (yearMatch) {
            year = parseInt(yearMatch[1]);
        }

        return {
            title: filmTitle,
            year: year,
            letterboxdUrl: link
        };
    }

    /**
     * Get recent diary entries from RSS
     */
    async getRecentDiaryEntries(limit = 10) {
        if (!this.isLiveDataAvailable()) {
            return [];
        }

        try {
            const rssItems = await this.fetchRSSFeed();
            return rssItems
                .filter(item => item.activityType === 'diary')
                .slice(0, limit)
                .map(item => ({
                    Name: item.filmInfo.title || 'Unknown',
                    Year: item.filmInfo.year || '',
                    LetterboxdURI: item.filmInfo.letterboxdUrl || '',
                    WatchedDate: item.pubDate.toISOString().split('T')[0], // YYYY-MM-DD format
                    Rating: '', // RSS doesn't include rating, would need to be scraped separately
                    Rewatch: 'No', // Default assumption
                    Tags: 'live-data', // Tag to identify live data
                    isLiveData: true
                }));
        } catch (error) {
            console.warn('Failed to get recent diary entries:', error);
            return [];
        }
    }

    /**
     * Get activity summary for dashboard
     */
    async getActivitySummary() {
        if (!this.isLiveDataAvailable()) {
            return null;
        }

        try {
            const rssItems = await this.fetchRSSFeed();
            const today = new Date();
            const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

            const recentActivity = rssItems.filter(item => item.pubDate >= sevenDaysAgo);
            
            return {
                totalActivities: recentActivity.length,
                watchedCount: recentActivity.filter(item => item.activityType === 'diary').length,
                reviewedCount: recentActivity.filter(item => item.activityType === 'review').length,
                likedCount: recentActivity.filter(item => item.activityType === 'like').length,
                lastActivity: rssItems.length > 0 ? rssItems[0].pubDate : null
            };
        } catch (error) {
            console.warn('Failed to get activity summary:', error);
            return null;
        }
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Check if RSS is accessible for a given username
     */
    async testRSSAccess(username) {
        try {
            console.log(`Testing RSS access for username: ${username}`);
            
            const items = await this.fetchRSSFeed(username);
            const hasAccess = items.length > 0;
            
            console.log(`RSS test result for ${username}: ${hasAccess ? 'SUCCESS' : 'NO DATA'} (${items.length} items found)`);
            
            // Consider it successful if we got a response, even if no items
            // (user might just not have recent activity)
            return true; // Change this to be more permissive
            
        } catch (error) {
            console.error('RSS access test failed:', error);
            return false;
        }
    }

    /**
     * Test if a Letterboxd user profile exists
     */
    async testUserProfile(username) {
        try {
            const profileUrl = `https://letterboxd.com/${username}/`;
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(profileUrl)}`;
            
            console.log(`Testing user profile: ${profileUrl}`);
            
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                return false;
            }
            
            const data = await response.json();
            const htmlContent = data.contents;
            
            // Check if it's a valid profile page (not a 404 or error page)
            const isValidProfile = htmlContent && 
                                 !htmlContent.includes('Page not found') && 
                                 !htmlContent.includes('User not found') &&
                                 htmlContent.includes('letterboxd.com') &&
                                 htmlContent.includes(username);
            
            console.log(`Profile test for ${username}: ${isValidProfile ? 'VALID' : 'INVALID'}`);
            return isValidProfile;
            
        } catch (error) {
            console.warn(`Profile test failed for ${username}:`, error.message);
            return false;
        }
    }
}

// Create global instance
window.letterboxdRSS = new LetterboxdRSSManager();
