# Use Node.js LTS slim version as base
FROM node:20-slim

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3010
ENV HOST=0.0.0.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install system utilities needed for Playwright's browser installer
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Install Playwright Chromium browser and its native system dependencies
RUN mkdir -p /ms-playwright && npx playwright install chromium --with-deps

# Copy the rest of the application files
COPY . .

# Create database and logs directories, and adjust ownership to Node user
RUN mkdir -p database logs && chown -R node:node /app /ms-playwright

# Run the app as a non-privileged user for security
USER node

# Expose the API and Dashboard port
EXPOSE 3010

# Start the application
CMD ["npm", "start"]
