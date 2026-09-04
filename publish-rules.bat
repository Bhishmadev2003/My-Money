@echo off
cd /d %~dp0
echo Publishing Firestore rules for My Money...
firebase deploy --only firestore:rules
pause
