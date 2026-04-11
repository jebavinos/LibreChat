import os
import requests
import pytest
from deepeval import assert_test
from deepeval.test_case import LLMTestCase, LLMTestCaseParams
from deepeval.metrics import AnswerRelevancyMetric, GEval

# ---------------------------------------------------------
# 1. Setup your API call to LibreChat here
# ---------------------------------------------------------

LIBRECHAT_API_KEY = os.getenv("LIBRECHAT_API_KEY", "your-api-key-here")
LIBRECHAT_URL = os.getenv("LIBRECHAT_URL", "http://localhost:3080/api/v1/chat/completions")

def call_stock_market_analyser(prompt: str) -> str:
    """
    Calls the LibreChat API, targeting the 'Stock_market_analyser' agent.
    Replace with your actual API integration.
    """
    headers = {
        "Authorization": f"Bearer {LIBRECHAT_API_KEY}",
        "Content-Type": "application/json"
    }

    # You may need to adjust the payload based on LibreChat's Assistants/Agents API
    payload = {
        "model": "Stock_market_analyser", # Might be the agent/assistant ID or model name
        "messages": [{"role": "user", "content": prompt}],
        "stream": False
    }

    try:
        # Uncomment below when you're ready to test with the real API:
        # response = requests.post(LIBRECHAT_URL, json=payload, headers=headers)
        # response.raise_for_status()
        # return response.json()["choices"][0]["message"]["content"]
        
        # MOCK RETURN FOR NOW:
        return (
            "Based on technical and fundamental analysis, here are 3 hidden gem stocks.\n"
            "This is a mocked response from Stock_market_analyser for prompt: " + prompt
        )
    except Exception as e:
        print(f"Error calling LibreChat API: {e}")
        return "Error occurred."


# ---------------------------------------------------------
# 2. Define DeepEval Metrics
# ---------------------------------------------------------

# Answer Relevancy measures how relevant the output is to the input query
answer_relevancy_metric = AnswerRelevancyMetric(threshold=0.7, model="gpt-4o-mini")

# GEval is a customizable metric. We'll define one evaluating the stock picks strategy.
stock_quality_geval = GEval(
    name="Stock Recommendations Quality",
    criteria="Determine whether the actual output provides actionable stock recommendations fitting the input criteria, accompanied by adequate justification.",
    evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
    threshold=0.7,
    model="gpt-4o-mini"
)


# ---------------------------------------------------------
# 3. Write pytest test cases
# ---------------------------------------------------------

@pytest.mark.parametrize("prompt, expected_output", [
    (
        "identify stocks which can give 10 percent returns in 10 sessions",
        "A list of stocks with a high probability of short-term upward momentum, backed by technical indicators or catalysts."
    ),
    (
        "Can you identify some small cap hidden gems?",
        "A list of fundamentally strong, under-the-radar small cap stocks with long term growth potential."
    )
])
def test_stock_marker_analyser(prompt, expected_output):
    # Step 1: Call the Agent
    actual_output = call_stock_market_analyser(prompt)

    # Step 2: Form a DeepEval TestCase
    test_case = LLMTestCase(
        input=prompt,
        actual_output=actual_output,
        expected_output=expected_output,
        retrieval_context=[] # Optional: Add retrieved knowledge if the agent uses RAG
    )

    # Step 3: Assert using the configured metrics
    assert_test(test_case, [answer_relevancy_metric, stock_quality_geval])

