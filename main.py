import json
from collections import defaultdict

def process_conversation_object(conversation_data, overall_model_counts):
    """
    Analyzes a single conversation object (passed as a Python dictionary)
    to count model usage and update overall totals.

    Args:
        conversation_data (dict): A dictionary representing one conversation.
        overall_model_counts (defaultdict): A dictionary to accumulate total
                                            model counts across all conversations.

    Returns:
        tuple: (str, dict) - The conversation title and a dictionary of
               model usage counts for this conversation.
    """
    title = conversation_data.get('title', 'Unknown Title')
    current_conversation_models = defaultdict(int)

    mapping_data = conversation_data.get('mapping', {})
    if not isinstance(mapping_data, dict):
        # Handle cases where mapping might not be a dictionary as expected
        # Or if it's missing, though .get({}, {}) handles the latter.
        print(f"Warning: 'mapping' in conversation titled '{title}' is not a dictionary. Skipping.")
        return title, dict(current_conversation_models)

    for node_id, node_data in mapping_data.items():
        if not isinstance(node_data, dict):
            # print(f"Warning: Node data for ID '{node_id}' in '{title}' is not a dictionary. Skipping node.")
            continue

        message = node_data.get('message')
        if message and isinstance(message, dict):
            author = message.get('author', {})
            content = message.get('content', {})
            metadata = message.get('metadata', {})

            if not isinstance(author, dict) or not isinstance(content, dict) or not isinstance(metadata, dict):
                # print(f"Warning: author, content, or metadata is not a dict in a message for '{title}'. Skipping message.")
                continue

            author_role = author.get('role')
            content_type = content.get('content_type')

            if author_role == 'assistant' and content_type == 'text':
                model_slug = metadata.get('model_slug')
                if model_slug:
                    current_conversation_models[model_slug] += 1
                    overall_model_counts[model_slug] += 1
    
    return title, dict(current_conversation_models)

def main():
    log_file_name = 'main.log'
    target_file = 'conversations.json'
    grand_total_model_usage = defaultdict(int)
    results_per_conversation = []
    all_conversations_list = []

    # Using a list to store log messages, then write all at once or progressively.
    # For simplicity here, we'll write as we go.
    with open(log_file_name, 'w', encoding='utf-8') as log_f:

        def log_message(message):
            log_f.write(message + '\n') # Corrected: Use '\n' for newline character
            # Optionally, also print to console if desired:
            # print(message)

        try:
            with open(target_file, 'r', encoding='utf-8') as f:
                all_conversations_list = json.load(f)
            
            if not isinstance(all_conversations_list, list):
                log_message(f"Error: Content of '{target_file}' is not a JSON array as expected.")
                all_conversations_list = [] 
        
        except FileNotFoundError:
            log_message(f"Error: The file '{target_file}' was not found.")
        except json.JSONDecodeError:
            log_message(f"Error: Failed to decode JSON from '{target_file}'. Make sure it's valid JSON.")
        except Exception as e:
            log_message(f"An unexpected error occurred while loading '{target_file}': {e}")

        if all_conversations_list:
            for conv_object in all_conversations_list:
                if not isinstance(conv_object, dict):
                    log_message(f"Warning: An item in '{target_file}' is not a dictionary (a conversation object). Skipping item.")
                    continue
                # Pass the log_message function or handle logging inside process_conversation_object if it needs to log warnings
                # For now, warnings from process_conversation_object are still print()
                title, models_in_conv = process_conversation_object(conv_object, grand_total_model_usage)
                results_per_conversation.append({'title': title, 'models_used': models_in_conv})

        # Output 1: Overall Model Usage
        log_message("Overall Model Usage Counts:")
        if grand_total_model_usage:
            for model, count in grand_total_model_usage.items():
                log_message(f"  {model}: {count}")
        else:
            if all_conversations_list: 
                log_message("  No models found matching criteria across all conversations.")
        
        log_message("") # Add a blank line between Overall and Per-Conversation sections

        # Output 2: Per-Conversation Model Usage
        log_message("Model Usage Per Conversation:")
        if results_per_conversation:
            for i, result in enumerate(results_per_conversation):
                if i > 0: # Add a newline before subsequent conversation titles for separation
                    log_message("") # This will just write a newline
                log_message(f"  Conversation Title: {result['title']}") # Removed leading \n, adjusted indentation
                if result['models_used']:
                    for model, count in result['models_used'].items():
                        log_message(f"    {model}: {count}")
                else:
                    log_message("    No models found matching criteria in this conversation.")
        elif all_conversations_list: 
            log_message("  No conversations yielded model usage data matching criteria.")
        
        print(f"Processing complete. Results logged to {log_file_name}")

if __name__ == "__main__":
    main()
