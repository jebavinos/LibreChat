#!/usr/bin/env python3
"""
Standalone script to refresh the access token using Selenium automation.
Reads credentials from environment variables and writes the token to ACCESS_TOKEN_FILE.
"""

import os
import sys
import time
import shutil
import tempfile
import pyotp
from kiteconnect import KiteConnect

# Selenium imports
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import StaleElementReferenceException, TimeoutException
# from webdriver_manager.chrome import ChromeDriverManager
from dotenv import load_dotenv

load_dotenv()

class LiveDataAutoLogin:
    def __init__(self, api_key, api_secret, user_id, password, totp_secret):
        self.api_key = api_key
        self.api_secret = api_secret
        self.user_id = user_id
        self.password = password
        self.totp_secret = totp_secret
        self.kite = KiteConnect(api_key=api_key)
    
    @staticmethod
    def _find_chrome_binary():
        """Find a Chrome/Chromium binary on Linux."""
        candidates = [
            os.environ.get("CHROME_BIN"),
            os.environ.get("GOOGLE_CHROME_BIN"),
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/opt/google/chrome/chrome",
            "/snap/bin/chromium",
            "/snap/bin/chromium-browser",
            shutil.which("google-chrome"),
            shutil.which("chrome"),
            shutil.which("chromium"),
            shutil.which("chromium-browser"),
        ]
        for path in candidates:
            if path and os.path.exists(path):
                return path
        return None

    @staticmethod
    def _find_chromedriver_binary(chrome_binary_path):
        """Find a chromedriver binary on Linux."""
        if chrome_binary_path and "/snap/" in chrome_binary_path:
            candidates = [
                 os.environ.get("CHROMEDRIVER_BIN"),
                 "/snap/bin/chromium.chromedriver",
            ]
            for path in candidates:
                if path and os.path.exists(path):
                    return path
        return shutil.which("chromedriver")
    
    def generate_fresh_totp(self):
        """Generate fresh TOTP code with timing info"""
        totp = pyotp.TOTP(self.totp_secret)
        current_time = int(time.time())
        time_remaining = 30 - (current_time % 30)
        code = totp.now()
        print(f"Generated TOTP: {code} (valid for {time_remaining}s)")
        return code, time_remaining
    
    def auto_login(self):
        # We need to use the kite connect login url generator
        # Even if we rename the wrapper, the underlying library is still KiteConnect
        login_url = self.kite.login_url()
        
        options = webdriver.ChromeOptions()
        options.add_argument('--headless=new')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-gpu')
        options.add_argument('--window-size=1920,1080')
        options.add_argument('--disable-software-rasterizer')
        options.add_argument('--remote-allow-origins=*')
        
        user_data_dir = tempfile.mkdtemp(prefix="livedata_chrome_")
        options.add_argument(f'--user-data-dir={user_data_dir}')
        
        chrome_binary = self._find_chrome_binary()
        if not chrome_binary:
            print("Chrome/Chromium binary not found.")
            return None
            
        options.binary_location = chrome_binary
        
        # Selenium 4.6+ includes Selenium Manager which automatically manages drivers.
        # We don't need manual driver management unless specific needs arise.
        # This avoids issues where webdriver-manager defaults to old versions (like 114)
        # when it fails to detect newer versions correctly.
        
        driver = None
        try:
            driver = webdriver.Chrome(options=options)
            wait = WebDriverWait(driver, 20)
            
            # Login Flow
            driver.get(login_url)
            
            # Credentials
            try:
                userid_field = wait.until(EC.element_to_be_clickable((By.ID, "userid")))
                userid_field.clear()
                userid_field.send_keys(self.user_id)
            except TimeoutException:
                print("Element 'userid' not found.")
                return None
            
            password_field = wait.until(EC.element_to_be_clickable((By.ID, "password")))
            password_field.clear()
            password_field.send_keys(self.password)
            
            driver.find_element(By.CSS_SELECTOR, "button[type='submit']").click()
            
            # TOTP Wait
            time.sleep(3)
            totp_code, time_remaining = self.generate_fresh_totp()
            if time_remaining < 5:
                time.sleep(time_remaining + 1)
                totp_code, time_remaining = self.generate_fresh_totp()

            # Enter TOTP - Retry loop
            print("Trying to enter TOTP code...")
            for i in range(5):
                try:
                    totp_field = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "input[type='number']")))
                    totp_field.clear()
                    totp_field.send_keys(totp_code)
                    print("TOTP entered successfully.")
                    break
                except Exception as e:
                    print(f"Retry {i+1}/5 finding TOTP field: {e}")
                    time.sleep(1)
            
            # Submit
            print("Attempting to click submit button...")
            for i in range(3):
                try:
                    btn = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "button[type='submit']")))
                    btn.click()
                    print("Submit button clicked.")
                    break
                except Exception as e:
                    print(f"Retry {i+1}/3 clicking submit: {e}")
                    time.sleep(1)

            # Wait for redirect
            print("Waiting for redirect to get request_token...")
            for _ in range(15):
                time.sleep(1)
                # The callback URL structure depends on Kite Connect settings
                if "request_token" in driver.current_url:
                    parts = driver.current_url.split("request_token=")
                    if len(parts) > 1:
                        request_token = parts[1].split("&")[0]
                        # KiteConnect generate_session
                        data = self.kite.generate_session(request_token, api_secret=self.api_secret)
                        return data["access_token"]
            
            return None

        except Exception as e:
            print(f"Error during login: {e}")
            return None
        finally:
            if driver:
                driver.quit()
            try:
                if os.path.exists(user_data_dir):
                    shutil.rmtree(user_data_dir)
            except:
                pass

if __name__ == "__main__":
    api_key = os.environ.get("ZERODHA_API_KEY")
    api_secret = os.environ.get("ZERODHA_API_SECRET")
    user_id = os.environ.get("ZERODHA_USER_ID")
    password = os.environ.get("ZERODHA_PASSWORD")
    totp_secret = os.environ.get("ZERODHA_TOTP_SECRET")
    
    token_file = os.environ.get("ACCESS_TOKEN_FILE", "kite_access_token.txt")
    
    if not all([api_key, api_secret, user_id, password, totp_secret]):
        print("Missing credentials in environment variables.")
        sys.exit(1)
        
    print("Starting automated login to refresh token...")
    # Instantiate the renamed class
    login = LiveDataAutoLogin(api_key, api_secret, user_id, password, totp_secret)
    token = login.auto_login()
    
    if token:
        with open(token_file, "w") as f:
            f.write(token)
        print(f"SUCCESS: Token written to {token_file}")
    else:
        print("FAILURE: Could not generate access token.")
        sys.exit(1)
