import sys
import json
from langchain_community.llms import Ollama

def analyze_employee_calls(calls_data):
    # Combine all call analyses
    combined_analysis = "\n\n".join([call.get('analysis', '') for call in calls_data if call.get('analysis')])

    # Initialize the Llama model
    model = Ollama(model="llama3")

    prompt = f"""
    Analyze the following combined call analyses for a sales representative:

    {combined_analysis}

    Based on these analyses, provide exactly 3 strengths and 3 weaknesses or areas for improvement for this sales representative. 
    Format your answer as follows:

    Strengths:
    1. [Strength 1]
    2. [Strength 2]
    3. [Strength 3]

    Weaknesses:
    1. [Weakness 1]
    2. [Weakness 2]
    3. [Weakness 3]

    Objection Handeling:
    1. [Good 1]
    2. [Bad 2]
    3. [Bad 3]

    Closing techniques:
    1. [1]
    2. [2]
    3. [3]

    Opening Line:
    1. [1]

    Sentiment throughout all calls:
    1. [Sentiment 1]
    2. [Sentiment 2]

    What they are lacking and why they may not be closing up to standards:
    1. [Lacking 1]
    2. [Lacking 2]
    3. [Lacking 3]

    Ensure you provide exactly 3 items for each category, no more and no less.
    And only return as the example had shown, don't deviate off just find the ones I said
    Like get 3 good things for strengths at the minimum
    and 3 weaknesses they mave displayed or at least areas where they could improve
    and fill out the others

    then also return their objection handeling ability
    add also closing techniques, like did the sales person actualy sell them or just manipulate them
    add also opening lines
    add also sentiment analysis
    add also where they are lacking that could be causing their close rates to not be as high
    """

    result = model.invoke(prompt)

    # Parse the result
    sections = result.split('\n\n')
    consistencies = sections[0].replace('Strengths:', '').strip()
    strengths = sections[1].replace('Weaknesses:', '').strip()
    weaknesses = sections[2].replace('Consistencies:', '').strip()

    # Return the analysis results
    return {
        "strengths": strengths,
        "weaknesses": weaknesses,
        "consistencies": consistencies
    }

if __name__ == "__main__":
    # Read input from stdin
    calls_data = json.loads(sys.stdin.read())
    
    # Perform analysis
    analysis_result = analyze_employee_calls(calls_data)
    
    # Print the result as JSON to stdout
    print(json.dumps(analysis_result))