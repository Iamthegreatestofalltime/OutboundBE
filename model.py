import sys
import os
from pydub import AudioSegment
import speech_recognition as sr
from langchain_community.llms import Ollama
from crewai import Agent, Task, Crew, Process
import re
import logging
from langchain.schema import HumanMessage

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def transcribe_audio(audio_path):
    # This function remains the same
    audio = AudioSegment.from_file(audio_path)
    wav_path = "temp.wav"
    audio.export(wav_path, format="wav")

    r = sr.Recognizer()
    with sr.AudioFile(wav_path) as source:
        audio_data = r.record(source)
        transcript = r.recognize_google(audio_data)

    os.remove(wav_path)
    # Save the raw transcript to a file
    with open('raw_transcript.txt', 'w') as f:
        f.write(transcript)

    print("\nRaw transcript has been saved to 'raw_transcript.txt'")
    return transcript

def split_into_sentences(text):
    # Split the text into sentences
    sentences = re.split(r'(?<=[.!?])\s+', text)
    return [s.strip() for s in sentences if s.strip()]

def assign_speakers_with_llama(transcript, model):
    prompt = f"""
    Given the following transcript of a sales call, reorganize it into a coherent conversation between an Agent and a Customer.
    The call begins with the Agent introducing themselves and asking how the Customer is doing.
    Ensure that each statement is logically assigned to the correct speaker based on the content and context.
    
    Format your response as:
    Agent: [Agent's statement]
    Customer: [Customer's statement]
    
    Make sure each statement is complete and makes sense on its own.
    If a statement seems to be split or misattributed, use your judgment to correct it.
    
    Original Transcript:
    {transcript}
    """
    
    reorganized_transcript = model.invoke(prompt)
    print("Reorganized Transcript:")
    print(reorganized_transcript)
    print("\n" + "-"*50 + "\n")

    # Post-process to ensure consistent formatting
    lines = reorganized_transcript.split('\n')
    processed_lines = []
    for line in lines:
        line = line.strip()
        if line.startswith("Agent:") or line.startswith("Customer:"):
            processed_lines.append(line)
        elif line:  # If there's content but no speaker label, append to the previous line
            if processed_lines:
                processed_lines[-1] += " " + line
    
    final_transcript = '\n'.join(processed_lines)
    print("Final Processed Transcript:")
    print(final_transcript)
    
    return final_transcript

def execute_task_and_capture(task, aggregated_results):
    try:
        print(f"Executing task for {task.agent.role}")
        print(f"Task description: {task.description}")
        
        # Execute the task using the agent's language model
        result = task.agent.llm.invoke(task.description)
        
        output = f"{task.agent.role} Output:\n{'-' * 40}\n{result}\n\n"
        
        # Append to aggregated results
        aggregated_results += output
        
        # Write to file in real-time
        with open('agent_outputs.txt', 'a', encoding='utf-8') as f:
            f.write(output)
        
        logging.info(f"Task executed and output captured for {task.agent.role}")
        return aggregated_results, result
    except Exception as e:
        error_msg = f"Error executing task for {task.agent.role}: {str(e)}"
        logging.error(error_msg)
        return aggregated_results + error_msg + "\n\n", error_msg

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python model.py <path_to_audio_file>")
        sys.exit(1)

    audio_path = sys.argv[1]
    
    # Initialize the Llama model
    model = Ollama(model="llama3")

    # Transcribe the audio
    transcript = transcribe_audio(audio_path)

    # Assign speakers to the transcript using Llama 3
    diarized_transcript = assign_speakers_with_llama(transcript, model)

    # Print the diarized transcript
    print("Diarized Transcript:")
    print(diarized_transcript)

    # Save the diarized transcript to a file
    with open('diarized_transcript.txt', 'w') as f:
        f.write(diarized_transcript)

    # Read the script
    script_path = './script.txt'
    try:
        with open(script_path, 'r') as file:
            script = file.read()
    except FileNotFoundError:
        print("Script file not found. Please ensure 'script.txt' exists in the current directory.")
        exit(1)

    # Define agents
    summarizer = Agent(
        role="Call Summarizer",
        goal="Analyze and summarize the call transcript",
        backstory="You are an expert in distilling key information from conversations",
        allow_delegation=False,
        llm=model
    )

    sentiment_analyzer = Agent(
        role="Sentiment Analyzer",
        goal="Perform sentiment analysis on the call transcript",
        backstory="You are skilled at detecting emotions and overall sentiment in text",
        allow_delegation=False,
        llm=model
    )

    objection_finder = Agent(
        role="Objection Identifier",
        goal="Identify any objections raised during the call",
        backstory="You are experienced in spotting customer concerns and objections",
        allow_delegation=False,
        llm=model
    )

    closing_technique_analyst = Agent(
        role="Closing Technique Analyst",
        goal="Identify and analyze closing techniques used in the call",
        backstory="You are an expert in sales techniques, particularly closing strategies",
        allow_delegation=False,
        llm=model
    )

    outcome_analyzer = Agent(
        role="Call Outcome Analyzer",
        goal="Determine the outcome of the call",
        backstory="You are skilled at assessing the results and next steps from conversations",
        allow_delegation=False,
        llm=model
    )

    opening_closing_analyst = Agent(
        role="Opening and Closing Analyst",
        goal="Analyze how the call was opened and closed",
        backstory="You are an expert in conversation structure and etiquette",
        allow_delegation=False,
        llm=model
    )

    script_adherence_analyst = Agent(
        role="Script Adherence Analyst",
        goal="Compare the call transcript with the provided script and analyze adherence",
        backstory="You are an expert in evaluating how closely sales representatives follow given scripts",
        allow_delegation=False,
        llm=model
    )

    # Define tasks
    task_summarize = Task(
        description=f"Summarize the key points of the call transcript: {diarized_transcript}",
        agent=summarizer,
        expected_output="A concise summary of the main points discussed in the call"
    )

    task_sentiment = Task(
        description=f"Analyze the overall sentiment of the call: {diarized_transcript}",
        agent=sentiment_analyzer,
        expected_output="An analysis of the call's sentiment, including any notable emotional shifts"
    )

    task_objections = Task(
        description=f"Identify any objections raised during the call: {diarized_transcript}",
        agent=objection_finder,
        expected_output="A list of objections raised by the customer during the call"
    )

    task_closing_techniques = Task(
        description=f"Identify and analyze any closing techniques used in the call: {diarized_transcript}",
        agent=closing_technique_analyst,
        expected_output="An analysis of the closing techniques employed, if any"
    )

    task_outcome = Task(
        description=f"Determine the outcome of the call and any next steps: {diarized_transcript}",
        agent=outcome_analyzer,
        expected_output="A clear statement of the call's outcome and any agreed-upon next steps"
    )

    task_opening_closing = Task(
        description=f"Analyze how the call was opened and closed: {diarized_transcript}",
        agent=opening_closing_analyst,
        expected_output="An analysis of the call's opening and closing, including effectiveness and areas for improvement"
    )

    task_script_adherence = Task(
        description=f"Compare the call transcript with the provided script and analyze adherence. Transcript: {diarized_transcript}. Script: {script}",
        agent=script_adherence_analyst,
        expected_output="An analysis of how closely the call followed the provided script, noting any significant deviations"
    )

    call_analysis_crew = Crew(
        agents=[summarizer, sentiment_analyzer, objection_finder, closing_technique_analyst, outcome_analyzer, opening_closing_analyst, script_adherence_analyst],
        tasks=[task_summarize, task_sentiment, task_objections, task_closing_techniques, task_outcome, task_opening_closing, task_script_adherence],
        verbose=2
    )

    # Clear the file before starting
    open('agent_outputs.txt', 'w').close()

    # Initialize aggregated results string
    aggregated_results = ""

    # Execute tasks and collect results
    results = []
    for task in call_analysis_crew.tasks:
        aggregated_results, result = execute_task_and_capture(task, aggregated_results)
        results.append(result)

    print("\nAnalysis complete. Results have been saved to 'agent_outputs.txt'")

    # Print the final aggregated results to console
    print("\nAggregated Results:")
    print(aggregated_results)

    # Print the raw results list
    print("\nRaw Results List:")
    print(results)