FROM python:3.12-slim

# System deps + Node.js 20
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Python packages
RUN pip install --no-cache-dir \
    numpy pandas matplotlib requests beautifulsoup4 scipy sympy

# Non-root user
RUN useradd -m -s /bin/bash sandbox
USER sandbox
WORKDIR /sandbox

CMD ["python3"]
