#!/bin/bash
# Run alfie-doctor and alert admin on critical failures

DOCTOR_OUTPUT=$(python3 /home/admin/.openclaw/workspace/alfie-doctor/doctor.py 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    # Critical failure detected
    echo "$DOCTOR_OUTPUT" | tail -30 > /tmp/doctor_failure.txt
    
    # Send alert to admin via Telegram (using OpenClaw message tool)
    # This will be done via OpenClaw cron job that calls ALFIE
    exit 1
else
    # All healthy
    exit 0
fi
