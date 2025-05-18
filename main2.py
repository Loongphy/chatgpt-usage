import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone

def get_last_seven_days_timestamps():
    """
    Calculates the Unix timestamps for the start and end of the last 7 days,
    including today, in UTC.
    The period starts 6 days ago at 00:00:00 UTC and ends today at 23:59:59.999999 UTC.
    """
    today_utc = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    
    # End of today
    end_of_today_utc = today_utc.replace(hour=23, minute=59, second=59, microsecond=999999)
    
    # Start of the 7-day period (6 days before today)
    start_of_period_utc = today_utc - timedelta(days=6)
    
    start_ts = start_of_period_utc.timestamp()
    end_ts = end_of_today_utc.timestamp()
    
    return start_ts, end_ts, start_of_period_utc, end_of_today_utc

def process_conversations_for_time_range(file_path, start_ts, end_ts):
    """
    Analyzes conversation data from a JSON file to count model usage within a
    specified time range.

    Args:
        file_path (str): Path to the JSON file containing conversation data.
        start_ts (float): The start Unix timestamp for the filtering period.
        end_ts (float): The end Unix timestamp for the filtering period.

    Returns:
        defaultdict: A dictionary with model slugs as keys and their usage counts
                     as values.
    """
    model_counts = defaultdict(int)
    conversations_data = []

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Check if the loaded data is a single conversation object or a list
            if isinstance(data, dict): # Assuming a single conversation object
                conversations_data.append(data)
            elif isinstance(data, list): # Assuming a list of conversation objects
                conversations_data = data
            else:
                print(f"Error: Content of '{file_path}' is not a valid JSON object or array.")
                return model_counts
                
    except FileNotFoundError:
        print(f"Error: The file '{file_path}' was not found.")
        return model_counts
    except json.JSONDecodeError:
        print(f"Error: Failed to decode JSON from '{file_path}'. Make sure it's valid JSON.")
        return model_counts
    except Exception as e:
        print(f"An unexpected error occurred while loading '{file_path}': {e}")
        return model_counts

    for conversation in conversations_data:
        if not isinstance(conversation, dict):
            # print(f"Warning: An item in the data is not a dictionary (a conversation object). Skipping item.")
            continue

        mapping_data = conversation.get('mapping', {})
        if not isinstance(mapping_data, dict):
            # print(f"Warning: 'mapping' in conversation titled '{conversation.get('title', 'Unknown Title')}' is not a dictionary. Skipping.")
            continue

        for node_id, node_data in mapping_data.items():
            if not isinstance(node_data, dict):
                # print(f"Warning: Node data for ID '{node_id}' is not a dictionary. Skipping node.")
                continue

            message = node_data.get('message')
            if message and isinstance(message, dict):
                create_time_ts = message.get('create_time')

                # Filter by time
                if create_time_ts is None or not (start_ts <= create_time_ts <= end_ts):
                    continue

                author = message.get('author', {})
                content = message.get('content', {})
                metadata = message.get('metadata', {})

                if not isinstance(author, dict) or not isinstance(content, dict) or not isinstance(metadata, dict):
                    # print(f"Warning: author, content, or metadata is not a dict in a message. Skipping message.")
                    continue
                
                author_role = author.get('role')
                content_type = content.get('content_type')

                if author_role == 'assistant' and content_type == 'text':
                    model_slug = metadata.get('model_slug')
                    if model_slug:
                        model_counts[model_slug] += 1
    
    return model_counts

def main():
    input_file = 'conversations.json' # Default input file
    
    start_ts, end_ts, start_dt, end_dt = get_last_seven_days_timestamps()
    
    print("Calculating model usage for the period:")
    print(f"Start: {start_dt.strftime('%Y-%m-%d %H:%M:%S %Z')} (Timestamp: {start_ts})")
    print(f"End:   {end_dt.strftime('%Y-%m-%d %H:%M:%S %Z')} (Timestamp: {end_ts})")
    print("-" * 30)

    model_usage = process_conversations_for_time_range(input_file, start_ts, end_ts)

    if model_usage:
        print("Model Usage Counts:")
        for model, count in model_usage.items():
            print(f"  {model}: {count}")
    else:
        print(f"No model usage found in '{input_file}' for the specified period.")

if __name__ == "__main__":
    main()
