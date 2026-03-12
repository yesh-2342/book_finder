Book Finder (Open Library)

A minimal, fast, and responsive web app to search books using the Open Library Search API. Built for Alex (college student) to quickly find books by title, author, subject, or ISBN, filter by language and year range, sort, paginate, and save favorites locally.

Features
- Search by: All, Title, Author, Subject, ISBN
- Filters: Language, First publish year range
- Sorting: Relevance, First publish year (asc/desc)
- Pagination: Prev/Next, jump-to-page, configurable results per page
- Favorites: Local-only via localStorage, quick access tab
- Debounced input, loading, error, and empty states
- URL state sync for easy sharing/revisiting searches

Run
Just open `index.html` in any modern browser. No build required.

API
Open Library Search API: `https://openlibrary.org/search.json`
- Examples:
  - By title: `https://openlibrary.org/search.json?title=The%20Hobbit`
  - General: `https://openlibrary.org/search.json?q=tolkien`
- Covers: `https://covers.openlibrary.org/b/id/{coverId}-M.jpg`

Notes
- The API supports `page` and (in practice) `limit`. If `limit` is ignored, the app still paginates based on `numFound` and slices client-side when needed.
- Year range is applied using a query filter on `first_publish_year`.


