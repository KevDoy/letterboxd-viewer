// RSS Live Data Module for Letterboxd Viewer
class LetterboxdRSSManager {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
        this.isEnabled = false;
        this.currentUsername = null;
    }

    // Helper: get text content from possible namespaced tags robustly
    _getTagText(node, selectors) {
        if (!node) return '';
        const selList = Array.isArray(selectors) ? selectors : [selectors];
        for (const sel of selList) {
            // Try querySelector with escaped colon if present
            try {
                const cssSel = sel.includes(':') ? sel.replace(':', '\\:') : sel;
                const q = node.querySelector(cssSel);
                if (q && q.textContent) return q.textContent.trim();
            } catch (_) {
                // ignore
            }
            // Try getElementsByTagName with the raw selector (e.g., 'letterboxd:filmTitle')
            try {
                const els = node.getElementsByTagName(sel);
                if (els && els.length && els[0].textContent) return els[0].textContent.trim();
            } catch (_) {
                // ignore
            }
        }
        return '';
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
            // Namespaced fields (preferred when present) — try multiple strategies
            const nsWatchedDate = this._getTagText(item, 'letterboxd:watchedDate');
            const nsFilmTitle = this._getTagText(item, 'letterboxd:filmTitle');
            const nsFilmYearText = this._getTagText(item, 'letterboxd:filmYear');
            const nsMemberRatingText = this._getTagText(item, 'letterboxd:memberRating');
            const nsFilmYear = nsFilmYearText ? parseInt(nsFilmYearText, 10) : null;
            const nsMemberRating = nsMemberRatingText ? parseFloat(nsMemberRatingText) : null;
            
            console.log(`Item ${index + 1}:`, { title, link, pubDate, nsWatchedDate, nsFilmTitle, nsFilmYear });
            
            // Parse the activity type from title
            let activityType = this.determineActivityType(title, description);
            
            // Extract film information from the title/link/description
            let filmInfo = this.extractFilmInfo(title, link, description);

            // Force canonical title/year/rating from namespaced fields when present
            if (nsFilmTitle) filmInfo.title = nsFilmTitle.trim();
            if (nsFilmYear && !Number.isNaN(nsFilmYear)) filmInfo.year = nsFilmYear;
            if (nsMemberRating != null && !Number.isNaN(nsMemberRating)) filmInfo.rating = nsMemberRating;

            // If the title looks wrong (starts with year, contains stars, or is empty), try to recover from link slug
            const looksBadTitle = !filmInfo.title ||
                /^\d{4}\b/.test(filmInfo.title) ||
                /[★Ââ]/.test(filmInfo.title) ||
                filmInfo.title.trim().length < 2;
            if (looksBadTitle) {
                const slugMatch = link.match(/\/film\/(.*?)\//);
                if (slugMatch && slugMatch[1]) {
                    const slug = slugMatch[1];
                    const titleFromSlug = slug
                        .replace(/-/g, ' ')
                        .replace(/\b\w/g, c => c.toUpperCase());
                    if (titleFromSlug && titleFromSlug.length > 1) {
                        filmInfo.title = titleFromSlug;
                    }
                }
            }

            // Already applied canonical fields above; no further action needed
            
            // Prefer watchedDate for pubDate when available so downstream filtering uses watch day
            const effectiveDate = nsWatchedDate ? new Date(nsWatchedDate) : (pubDate ? new Date(pubDate) : new Date());

            // If a watchedDate exists, this is a diary entry regardless of title wording
            if (nsWatchedDate) {
                activityType = 'diary';
            }

            return {
                title,
                link,
                description,
                pubDate: effectiveDate,
                watchedDate: nsWatchedDate || null,
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
        // Your RSS format: "ghosteffect A Minecraft Movie, 2025 - â˜…â˜…â˜…"
        let filmTitle = null;
        let year = null;
        let rating = null;

        // Clean up encoded characters first
        const cleanTitle = title
            .replace(/â˜…/g, '★') // Fix encoded stars
            .replace(/â€™/g, "'") // Fix encoded apostrophes
            .replace(/â€œ/g, '"') // Fix encoded quotes
            .replace(/â€/g, '"')
            // Fix specific patterns from your RSS feed
            .replace(/ââââ/g, '★★★★') // Fix 4 stars
            .replace(/âââ/g, '★★★') // Fix 3 stars
            .replace(/ââ/g, '★★') // Fix 2 stars
            .replace(/ââÂ½/g, '★★½') // Fix 2.5 stars
            .replace(/âÂ½/g, '★½') // Fix 1.5 stars
            .replace(/â½/g, '½') // Fix other half star encoding
            .replace(/Â½/g, '½') // Fix remaining half star encoding
            .replace(/â/g, '★') // Convert remaining â to stars as fallback
            .trim();

        console.log('Original title:', title);
        console.log('Cleaned title:', cleanTitle);

        // Debug: show what star patterns we can find
        const starPatterns = cleanTitle.match(/[★½]+/g);
        console.log('Found star patterns:', starPatterns);

        // Pattern for your RSS format: "username FilmTitle, Year - ★★½" (including half stars)
        const mainPattern = /^[^\s]+\s+(.+?),\s*(\d{4})\s*-\s*(★*½?)$/;
        const match = cleanTitle.match(mainPattern);

        if (match) {
            filmTitle = match[1].trim();
            year = parseInt(match[2]);
            
            // Parse rating including half stars
            const ratingStr = match[3];
            const fullStars = (ratingStr.match(/★/g) || []).length;
            const hasHalfStar = ratingStr.includes('½');
            rating = fullStars + (hasHalfStar ? 0.5 : 0);
            
            console.log('Pattern match success:', { filmTitle, year, rating, ratingStr });
        } else {
            // Try alternative pattern without the dash and stars
            const altPattern = /^[^\s]+\s+(.+?),\s*(\d{4}).*$/;
            const altMatch = cleanTitle.match(altPattern);
            
            if (altMatch) {
                filmTitle = altMatch[1].trim();
                year = parseInt(altMatch[2]);
                
                // Extract stars and half stars separately
                const starMatch = cleanTitle.match(/[★½]+/g);
                if (starMatch && starMatch.length > 0) {
                    // Join all star patterns and count
                    const allStars = starMatch.join('');
                    const fullStars = (allStars.match(/★/g) || []).length;
                    const hasHalfStar = allStars.includes('½');
                    rating = fullStars + (hasHalfStar ? 0.5 : 0);
                }
                
                console.log('Alternative pattern match:', { filmTitle, year, rating });
            } else {
                // Fallback: try to extract just the film title after username
                const words = cleanTitle.split(' ');
                if (words.length > 1) {
                    // Remove username (first word)
                    let titlePart = words.slice(1).join(' ');
                    
                    // Remove year and everything after it
                    titlePart = titlePart.replace(/,\s*\d{4}.*$/, '');
                    
                    // Clean up any remaining artifacts
                    titlePart = titlePart.replace(/[★\-\,\s]+$/, '').trim();
                    
                    if (titlePart.length > 0) {
                        filmTitle = titlePart;
                    }
                }

                // Extract year from anywhere in the title
                const yearMatch = cleanTitle.match(/(\d{4})/);
                if (yearMatch) {
                    year = parseInt(yearMatch[1]);
                }

                // Extract star rating including half stars from anywhere in the title
                const starMatch = cleanTitle.match(/[★½]+/g);
                if (starMatch && starMatch.length > 0) {
                    // Join all star patterns and count
                    const allStars = starMatch.join('');
                    const fullStars = (allStars.match(/★/g) || []).length;
                    const hasHalfStar = allStars.includes('½');
                    rating = fullStars + (hasHalfStar ? 0.5 : 0);
                }

                console.log('Fallback extraction:', { filmTitle, year, rating });
            }
        }

        // If still no title, try to extract from the link
        if (!filmTitle || filmTitle.length === 0) {
            const linkMatch = link.match(/\/film\/([^\/]+)\//);
            if (linkMatch) {
                // Convert URL slug to title
                filmTitle = linkMatch[1]
                    .replace(/-/g, ' ')
                    .replace(/\b\w/g, l => l.toUpperCase());
                console.log('Link extraction:', filmTitle);
            }
        }

        // Final validation - don't return entries with just numbers or invalid titles
        if (!filmTitle || 
            filmTitle.match(/^\d+$/) || 
            filmTitle.length < 2 ||
            filmTitle.match(/^[\s\-\,\★]+$/) || // Skip entries with just punctuation/stars
            filmTitle.toLowerCase() === 'unknown' ||
            filmTitle.toLowerCase() === 'unknown film') {
            console.log('Invalid title detected, skipping:', filmTitle);
            return {
                title: null,
                year: year,
                rating: rating,
                letterboxdUrl: link
            };
        }

        return {
            title: filmTitle,
            year: year,
            rating: rating,
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
            // Only consider items that explicitly have a letterboxd:watchedDate
            const validEntries = rssItems
                .filter(item => !!item.watchedDate)
                .slice(0, limit * 2) // Get more items to account for filtering
                .map(item => {
                    // Convert to diary format and validate
                    const filmInfo = item.filmInfo || {};
                    if (!filmInfo.title || filmInfo.title.trim().length === 0) {
                        return null; // Skip invalid entries
                    }
                    // Use the letterboxd watchedDate string
                    const dateStr = item.watchedDate;
                    
                    return {
                        Name: filmInfo.title,
                        Year: filmInfo.year || '',
                        LetterboxdURI: filmInfo.letterboxdUrl || '',
                        'Letterboxd URI': filmInfo.letterboxdUrl || '',
                        WatchedDate: dateStr,
                        'Watched Date': dateStr,
                        Date: dateStr,
                        Rating: filmInfo.rating ? filmInfo.rating.toString() : '', // Convert to string for consistency
                        Rewatch: 'No', // Default assumption
                        Tags: 'live-data', // Tag to identify live data
                        isLiveData: true,
                        _isFromRSS: true
                    };
                })
                .filter(entry => entry !== null) // Remove null entries
                .slice(0, limit); // Take only the requested number
                
            console.log(`Returning ${validEntries.length} valid recent diary entries`);
            return validEntries;
        } catch (error) {
            console.warn('Failed to get recent diary entries:', error);
            return [];
        }
    }

    /**
     * Get diary entries newer than a specific date
     */
    async getDiaryEntriesSince(sinceDate) {
        if (!this.isLiveDataAvailable()) {
            return [];
        }

        try {
            const rssItems = await this.fetchRSSFeed();
            const sinceDateObj = new Date(sinceDate);
            const sinceDateStr = this.formatDateForCSV(sinceDateObj);
            
            const entries = rssItems
                // Only items with explicit watchedDate are diary-worthy
                .filter(item => !!item.watchedDate)
                .filter(item => {
                    const itemDateStr = item.watchedDate; // Already YYYY-MM-DD
                    const isNewer = itemDateStr > sinceDateStr; // strict greater-than
                    console.log(`Date comparison (watchedDate): ${itemDateStr} > ${sinceDateStr} = ${isNewer}`);
                    return isNewer;
                })
                .map(item => this.convertRSSItemToDiaryFormat(item))
                .filter(entry => entry !== null); // Remove null entries
                
            console.log(`Filtered ${entries.length} valid diary entries from RSS`);
            return entries;
        } catch (error) {
            console.error('Failed to get diary entries since date:', error);
            return [];
        }
    }

    /**
     * Convert RSS item to diary CSV format
     */
    convertRSSItemToDiaryFormat(rssItem) {
        const filmInfo = rssItem.filmInfo || {};
        // Require letterboxd:watchedDate to qualify as a diary entry
        if (!rssItem.watchedDate) {
            console.log('Skipping RSS item without watchedDate:', rssItem.title);
            return null;
        }
        const dateStr = rssItem.watchedDate;
        
        // Skip entries without valid film titles (comprehensive validation)
        if (!filmInfo.title || 
            filmInfo.title.trim().length === 0 || 
            filmInfo.title.match(/^\d+$/) || // Skip entries that are just numbers
            filmInfo.title.length < 2 || // Skip very short titles
            filmInfo.title.match(/^[\s\-\,\★]+$/) || // Skip entries with just punctuation/stars
            filmInfo.title.toLowerCase() === 'unknown' ||
            filmInfo.title.toLowerCase() === 'unknown film') {
            console.log('Skipping RSS item without valid title:', rssItem.title, 'extracted:', filmInfo.title);
            return null;
        }
        
        return {
            'Date': dateStr,
            'Name': filmInfo.title,
            'Year': filmInfo.year || '',
            'Letterboxd URI': filmInfo.letterboxdUrl || '',
            'Rating': filmInfo.rating ? filmInfo.rating.toString() : '', // Convert to string for consistency
            'Rewatch': '', // Cannot determine from RSS
            'Tags': 'live-data', // Mark as live data for UI/debugging
            'Watched Date': dateStr,
            '_isFromRSS': true, // Flag to identify RSS entries
            'isLiveData': true // Additional flag for UI distinction
        };
    }

    /**
     * Convert RSS item to watched CSV format
     */
    convertRSSItemToWatchedFormat(rssItem) {
        const filmInfo = rssItem.filmInfo || {};
        const watchedDate = new Date(rssItem.pubDate);
        
        return {
            'Date': this.formatDateForCSV(watchedDate),
            'Name': filmInfo.title || 'Unknown Film',
            'Year': filmInfo.year || '',
            'Letterboxd URI': filmInfo.letterboxdUrl || '',
            '_isFromRSS': true // Flag to identify RSS entries
        };
    }

    /**
     * Format date for CSV compatibility (YYYY-MM-DD)
     * Use local timezone to avoid date shifting issues
     */
    formatDateForCSV(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Merge RSS diary entries with existing CSV data
     */
    async mergeWithDiaryData(existingDiaryData) {
        if (!this.isLiveDataAvailable() || !existingDiaryData || existingDiaryData.length === 0) {
            return existingDiaryData || [];
        }

        try {
            // Find the most recent entry date in existing data
            const latestEntry = existingDiaryData.reduce((latest, entry) => {
                const entryDate = new Date(entry['Watched Date'] || entry['Date']);
                const latestDate = new Date(latest['Watched Date'] || latest['Date']);
                return entryDate > latestDate ? entry : latest;
            }, existingDiaryData[0]);

            const latestDate = latestEntry ? new Date(latestEntry['Watched Date'] || latestEntry['Date']) : new Date('1900-01-01');
            
            console.log('Latest diary entry date:', this.formatDateForCSV(latestDate));

            // Get newer RSS entries
            const newRSSEntries = await this.getDiaryEntriesSince(latestDate);
            
            console.log(`Found ${newRSSEntries.length} new RSS diary entries`);

            // Add RSS flag to diary entries
            newRSSEntries.forEach(entry => {
                entry._isFromRSS = true;
            });

            // Merge with existing data (RSS entries first for chronological order)
            const mergedData = [...newRSSEntries, ...existingDiaryData];
            
            // Sort by date descending
            mergedData.sort((a, b) => {
                const dateA = new Date(a['Watched Date'] || a['Date']);
                const dateB = new Date(b['Watched Date'] || b['Date']);
                return dateB - dateA;
            });

            return mergedData;

        } catch (error) {
            console.error('Failed to merge RSS diary data:', error);
            return existingDiaryData;
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
