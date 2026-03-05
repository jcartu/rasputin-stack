#!/usr/bin/env python3
"""
Self-Play Task Solver - Attempts to solve coding tasks using local LLM

Uses Ollama/vLLM to generate solutions iteratively with test feedback.

Usage:
    python selfplay_solver.py --task task.json --model qwen3-coder:30b
    python selfplay_solver.py --task task.json --model qwen3-coder:30b --max-attempts 5
"""

import os
import sys
import json
import time
import uuid
import shutil
import argparse
import subprocess
from typing import Dict, Any, List, Optional
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: requests library required. Install with: pip install requests")
    sys.exit(1)


class TaskSolver:
    """Solves coding tasks using local LLM"""

    def __init__(
        self,
        model: str = "qwen3-coder:30b",
        ollama_url: str = "http://localhost:11434",
        vllm_url: str = "http://localhost:8001",
        max_attempts: int = 3,
        timeout: int = 300,
        verbose: bool = False
    ):
        self.model = model
        self.ollama_url = ollama_url
        self.vllm_url = vllm_url
        self.max_attempts = max_attempts
        self.timeout = timeout
        self.verbose = verbose

    def log(self, msg: str):
        """Print if verbose mode enabled"""
        if self.verbose:
            print(f"[Solver] {msg}")

    def create_workspace(self) -> str:
        """Create isolated workspace for task"""
        workspace = f"/tmp/selfplay_task_{uuid.uuid4().hex[:8]}"
        os.makedirs(workspace, exist_ok=True)
        self.log(f"Created workspace: {workspace}")
        return workspace

    def cleanup_workspace(self, workspace: str):
        """Remove workspace"""
        try:
            shutil.rmtree(workspace)
            self.log(f"Cleaned up workspace: {workspace}")
        except Exception as e:
            self.log(f"Failed to cleanup workspace: {e}")

    def call_ollama(self, prompt: str, system: str = None) -> str:
        """Call Ollama API"""
        self.log(f"Calling Ollama with model: {self.model}")
        
        try:
            payload = {
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.7,
                    "num_predict": 4096
                }
            }
            
            if system:
                payload["system"] = system
            
            response = requests.post(
                f"{self.ollama_url}/api/generate",
                json=payload,
                timeout=self.timeout
            )
            response.raise_for_status()
            
            result = response.json()
            return result.get("response", "")
            
        except Exception as e:
            self.log(f"Ollama call failed: {e}")
            return ""

    def call_vllm(self, prompt: str, system: str = None) -> str:
        """Call vLLM API"""
        self.log(f"Calling vLLM with model: {self.model}")
        
        try:
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})
            
            payload = {
                "model": self.model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 4096
            }
            
            response = requests.post(
                f"{self.vllm_url}/v1/chat/completions",
                json=payload,
                timeout=self.timeout
            )
            response.raise_for_status()
            
            result = response.json()
            return result["choices"][0]["message"]["content"]
            
        except Exception as e:
            self.log(f"vLLM call failed: {e}")
            return ""

    def call_llm(self, prompt: str, system: str = None) -> str:
        """Call LLM (try vLLM first, fallback to Ollama)"""
        # Try vLLM first
        response = self.call_vllm(prompt, system)
        if response:
            return response
        
        # Fallback to Ollama
        return self.call_ollama(prompt, system)

    def extract_code_blocks(self, response: str) -> List[Dict[str, str]]:
        """Extract code blocks from LLM response"""
        import re
        
        # Pattern for ```language\ncode\n```
        pattern = r'```(\w+)?\n(.*?)```'
        matches = re.findall(pattern, response, re.DOTALL)
        
        blocks = []
        for lang, code in matches:
            blocks.append({
                "language": lang or "unknown",
                "code": code.strip()
            })
        
        return blocks

    def create_solution_files(self, workspace: str, code_blocks: List[Dict[str, str]]) -> List[str]:
        """Create solution files from code blocks"""
        files = []
        
        for i, block in enumerate(code_blocks):
            # Infer filename from language
            lang = block["language"].lower()
            if lang in ["python", "py"]:
                ext = "py"
            elif lang in ["javascript", "js"]:
                ext = "js"
            elif lang in ["typescript", "ts"]:
                ext = "ts"
            elif lang in ["java"]:
                ext = "java"
            elif lang in ["cpp", "c++"]:
                ext = "cpp"
            elif lang in ["go"]:
                ext = "go"
            else:
                ext = "txt"
            
            filename = f"solution_{i}.{ext}"
            filepath = os.path.join(workspace, filename)
            
            with open(filepath, 'w') as f:
                f.write(block["code"])
            
            files.append(filepath)
            self.log(f"Created file: {filename}")
        
        return files

    def run_tests(self, workspace: str, task: Dict[str, Any]) -> Dict[str, Any]:
        """Run tests on solution"""
        self.log("Running tests...")
        
        result = {
            "passed": False,
            "output": "",
            "errors": []
        }
        
        # Check if Python solution exists
        py_files = [f for f in os.listdir(workspace) if f.endswith('.py')]
        
        if not py_files:
            result["errors"].append("No Python files found in solution")
            return result
        
        # Try to run the main file
        main_file = py_files[0]
        
        try:
            cmd_result = subprocess.run(
                ["python3", main_file],
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            result["output"] = cmd_result.stdout
            
            if cmd_result.returncode == 0:
                result["passed"] = True
                self.log("Tests passed!")
            else:
                result["errors"].append(f"Exit code: {cmd_result.returncode}")
                result["errors"].append(cmd_result.stderr)
                self.log(f"Tests failed: {cmd_result.stderr}")
        
        except subprocess.TimeoutExpired:
            result["errors"].append("Test execution timeout")
            self.log("Test timeout")
        
        except Exception as e:
            result["errors"].append(f"Test execution error: {str(e)}")
            self.log(f"Test error: {e}")
        
        return result

    def generate_prompt(
        self,
        task: Dict[str, Any],
        attempt: int,
        previous_error: str = None
    ) -> str:
        """Generate prompt for LLM"""
        
        system = """You are an expert software engineer. Generate complete, working code solutions.
        
Rules:
- Provide complete, runnable code in code blocks with language tags
- Include all necessary imports and dependencies
- Add error handling and input validation
- Write clean, well-documented code
- If fixing errors, explain what went wrong and how you fixed it"""
        
        prompt = f"""Task: {task['title']}

Description:
{task['description']}

Difficulty: {task['difficulty']}
Type: {task['type']}

Test Criteria:
{chr(10).join(f"- {criterion}" for criterion in task['test_criteria'])}

"""
        
        if attempt > 1 and previous_error:
            prompt += f"""
PREVIOUS ATTEMPT FAILED:
{previous_error}

Please fix the error and provide a corrected solution."""
        
        prompt += "\n\nGenerate a complete solution with code blocks:"
        
        return prompt, system

    def solve(self, task: Dict[str, Any]) -> Dict[str, Any]:
        """
        Attempt to solve a task
        
        Returns:
            Dict with solution, success status, attempts, and trajectory
        """
        self.log(f"Solving task: {task['title']}")
        
        result = {
            "task_id": task["id"],
            "task_title": task["title"],
            "success": False,
            "attempts": 0,
            "solution_files": [],
            "trajectory": [],
            "final_output": None,
            "workspace": None
        }
        
        workspace = self.create_workspace()
        result["workspace"] = workspace
        
        previous_error = None
        
        try:
            for attempt in range(1, self.max_attempts + 1):
                self.log(f"Attempt {attempt}/{self.max_attempts}")
                result["attempts"] = attempt
                
                # Generate prompt
                prompt, system = self.generate_prompt(task, attempt, previous_error)
                
                # Call LLM
                response = self.call_llm(prompt, system)
                
                if not response:
                    self.log("Empty response from LLM")
                    previous_error = "LLM returned empty response"
                    continue
                
                # Record trajectory step
                trajectory_step = {
                    "attempt": attempt,
                    "prompt": prompt,
                    "response": response,
                    "timestamp": datetime.utcnow().isoformat()
                }
                
                # Extract code blocks
                code_blocks = self.extract_code_blocks(response)
                
                if not code_blocks:
                    self.log("No code blocks found in response")
                    previous_error = "No code blocks found in LLM response"
                    trajectory_step["error"] = previous_error
                    result["trajectory"].append(trajectory_step)
                    continue
                
                # Create solution files
                solution_files = self.create_solution_files(workspace, code_blocks)
                result["solution_files"] = solution_files
                
                # Run tests
                test_result = self.run_tests(workspace, task)
                trajectory_step["test_result"] = test_result
                result["trajectory"].append(trajectory_step)
                
                if test_result["passed"]:
                    self.log("Solution passed tests!")
                    result["success"] = True
                    result["final_output"] = test_result["output"]
                    break
                else:
                    # Prepare error feedback for next attempt
                    previous_error = "\n".join([
                        "Test failed:",
                        test_result["output"],
                        *test_result["errors"]
                    ])
                    self.log(f"Tests failed: {previous_error}")
        
        finally:
            # Don't cleanup workspace yet - keep for trajectory collection
            pass
        
        return result


def main():
    """CLI interface"""
    parser = argparse.ArgumentParser(
        description="Solve coding tasks using local LLM"
    )
    parser.add_argument("--task", "-t", required=True, help="Task JSON file")
    parser.add_argument("--model", "-m", default="qwen3-coder:30b", help="LLM model")
    parser.add_argument("--ollama-url", default="http://localhost:11434", help="Ollama API URL")
    parser.add_argument("--vllm-url", default="http://localhost:8001", help="vLLM API URL")
    parser.add_argument("--max-attempts", type=int, default=3, help="Max solution attempts")
    parser.add_argument("--timeout", type=int, default=300, help="LLM timeout (seconds)")
    parser.add_argument("--output", "-o", help="Output JSON file (default: stdout)")
    parser.add_argument("--keep-workspace", action="store_true", help="Keep workspace after completion")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    # Load task
    with open(args.task, 'r') as f:
        task_data = json.load(f)
    
    # If tasks array, take first task
    if isinstance(task_data, dict) and "tasks" in task_data:
        task = task_data["tasks"][0]
    else:
        task = task_data
    
    # Solve task
    solver = TaskSolver(
        model=args.model,
        ollama_url=args.ollama_url,
        vllm_url=args.vllm_url,
        max_attempts=args.max_attempts,
        timeout=args.timeout,
        verbose=args.verbose
    )
    
    result = solver.solve(task)
    
    # Cleanup workspace unless --keep-workspace
    if not args.keep_workspace:
        solver.cleanup_workspace(result["workspace"])
        result["workspace"] = "(cleaned up)"
    
    # Output
    output_json = json.dumps(result, indent=2)
    
    if args.output:
        with open(args.output, 'w') as f:
            f.write(output_json)
        print(f"Result saved to {args.output}")
    else:
        print(output_json)
    
    # Summary
    print("\n" + "=" * 60)
    print("Solution Summary")
    print("=" * 60)
    print(f"Task: {result['task_title']}")
    print(f"Success: {'✓' if result['success'] else '✗'}")
    print(f"Attempts: {result['attempts']}/{args.max_attempts}")
    
    if result['success']:
        print(f"Solution files: {len(result['solution_files'])}")
        print("\nOutput:")
        print(result['final_output'])
    else:
        print("\nFailed to solve task")
        if result['trajectory']:
            last = result['trajectory'][-1]
            if 'test_result' in last:
                print("Last error:")
                for error in last['test_result']['errors'][:3]:
                    print(f"  {error}")
    
    sys.exit(0 if result['success'] else 1)


if __name__ == "__main__":
    main()
