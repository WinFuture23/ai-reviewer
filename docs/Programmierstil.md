# Programmierstil

<aside>
☝ Das sind die allgemeinen Richtlinien für alle Programmierer, die an WinFuture mit programmieren. Wer diese nicht aufmerksam gelesen hat, soll **KEINEN** Quelltext schreiben. Wer die Richtlinien nicht beachtet, bekommt eins auf den Deckel!

</aside>

# Namenskonventionen

- Kommentare werden vorzugsweise in Englisch verfasst, Namen immer in Englisch vergeben.
- Alle Namen werden in kleinen Buchstaben verfasst.
- Zusammengesetzte Wörter werden mit einem Unterstrich _ getrennt.
- Konstanten werden komplett in Großbuchstaben geschrieben.
    
    ## Dateinamen
    
    Dateien enthalten immer genau eine Klasse. Sie liegen in einer Ordnerstruktur, die die Paketstruktur widerspiegelt und heißen genau wie die Klasse mit der Endung `.class.php`.
    
    ## Klassennamen
    
    - Jede Klasse ist mit dem Präfix `wfv4_` zu versehen.
    - Der Klassenname spiegelt den Ort der Datei auf dem Dateisystem wieder, hierbei sind die Verzeichnisstrenner (`/`) durch `_` zu ersetzen.
    - Werden bei Klassen Pattern verwendet, sind diese gegebenenfalls im Namen der Klasse mit anzugeben (z.B. Factory, aber nicht Singleton).
    - Beispiel: **wfv4_model_mysqlfactory** entspricht der Datei `/wfv4/classes/model/mysqlfactory.class.php`
    
    ## Methodennamen
    
    Methoden sollten möglichst mit einem Verb beginnen, das die ausgeführte Funktion widerspiegelt. 
    
    Beispiele hierfür sind:
    
    - `get_*` zum auslesen eines Attributes
    - `set_*` zum setzen eines Attributes
    - `is_*` Methode, die ein Bool als Rückgabewert hat
    - `get` zum holen eines Datensatzes
    - `get_all` zum holen aller Datensätze
    - `get_by_*` zum holen eines oder mehrerer Datensätze mit Bedingung
    - `create` zum Daten einfügen
    - `update` zum Aktualisieren von Daten
    - `remove` zum Daten entfernen
    
    ## Variablennamen
    
    - Zählvariablen sind mit `i`, `j`, `k`, `l`, `m`, `n` zu bezeichnen.
    - Bei foreach-Schleifen soll `foreach( $values as $k => $v )` oder `foreach( $values as $value )` verwendet werden
    - Variablen und temporäre Variablen sind mit einem bezeichnenden Namen zu versehen!
    - Häufig verwendet werden `$result` für SQL-Query- und andere -Results, `$row` für einzelne Zeilen eines results, `$k` für Keys bei Arrays oder Objekten.

---

# Deklarationen

- Globale Funktionen sind zu vermeiden. Es soll entweder eine Klassenmethode oder eine Lambda-Funktion (lokale Variable) genutzt werden.
- Funktionen, die nur an einer einzigen Stelle aufgerufen werden, sind zu vermeiden. In solchen Fällen sollte generell auf eine Funktion verzichtet werden.
- Jede Deklaration ist in eine eigene Zeile zu schreiben und zu Kommentieren.
- Attribute einer Klasse sind vor den Methoden der Klasse zu deklarieren.
- In einer Methode verwendete Variablen sind möglichst am Anfang der Methode zu initialisieren.

# Ausdrücke und Strukturen

- Codeblöcke sind in geschweifte Klammern zu fassen, auch wenn sie nur eine Anweisung/Zeile enthalten. Die öffnende Klammer ist immer auf der gleichen Zeile zu notieren wie die dazugehörige Bedingung. Die schließende Klammer ist auf einer eigenen Zeile zu notieren. Das entspricht weitestgehend dem
- 
- Hinter einer öffnenden Klammer und vor einer schließenden Klammer ist ein Leerzeichen zu setzen, sofern etwas in der Klammer steht z.B. nicht bei `$result -> next();`.
- Zwischen Methodennamen *print();* bzw. Kontrollstrukturköpfen `if( $yes )` und der öffnenden Klammer ist kein Leerzeichen zu setzen.
- Bei If-Else Blöcken sieht das beispielsweise wie folgt aus:
    
    ```php
    if( FALSE ) {
      echo 'FALSE';
    } else {
      echo 'TRUE';
    }
    if( TRUE ) { exit };
    ```
    
    Weitere Beispiele:
    
    ```php
    $a = 1 + 1;
    ob_start();
    $filename_part = substr( 'asdfgh', 4 );
    if( $a && ( $b || wfv4_lib_validate::is_int( $c ) ) ) {
      echo $a.$b;
      echo $session->get_session_id();
      echo
    		$bla.'Hallo hallo hallo ' //am Ende einer Zeile kein Verbindungs-Zeichen
    		.'bla bla bla';
    
    }
    ```
    

# Einrückung

- Einrückungen sind generell mit einem Tabulator durchzuführen, Leerzeichen sind zur Einrückung nicht gestattet. Die Standart-Tabulatorenweite ist 4.
- Alle Blöcke sollen eingerückt werden.
- Zeilen, die länger als 80 Zeichen sind, sollten vermieden werden.
- Die Einrückung von PHP-Code innerhalb von HTML-Blöcken soll so durchgeführt werden, dass dadurch die Einrückung des ausgegebenen HTML-Codes nicht geändert wird. Das betrifft insbesondere die öffnenden und schließenden PHP-Tags `<?php` und `?>`.

# Freiraum

- Freiraum erhöht die Lesbarkeit von Quelltext, indem logisch zusammengehörige Blöcke auch optisch gegliedert werden.
- **Eine** Leerzeile ist an folgenden Stellen einzufügen:
    1. vor Methodendeklarationen
    2. vor Kommentarblöcken
    3. vor einzeiligen Kommentaren
    4. nach Variablendeklarationen
    5. als Trennung von logischen Blöcken innerhalb von Methoden
    6. hinter umgebrochenen Zeilen, die sonst länger als 80 Zeichen wären
    7. vor und nicht hinter Kontrollstrukturen (wie z.B. `if`, `for`, `foreach`, `while`, `class`, `function`). Beispiel:
        
        ```php
        //Diese Funktion ist ein Beispiel
        function test( $text ) {
            $text2 =
        			'Hallo, es wurde kein Text übergeben,'
              .'daher wird dieser Standarttext ausgegeben.';
         
            for( $i = 0; $i < 10; $i++ ) {
                echo $i;    
            }
         
            if( !empty( $text ) {
                echo $text;
            } else {
         
                // Wenn ein leerer Text übergeben wurde, dann Standardtext ausgeben
                echo $text2;
            }
        }
        ```
        

# Kommentare

- Es sind [PHPDoc](http://www.phpdoc.org/) Kommentare der Form zu verwenden.
    
    ```php
    /** 
    * Kommentar
    * @phpdocbefehl phpdocargumente
    */
    ```
    
- Zu jeder Methode sind mindestens folgende PHPDoc Elemente zu notieren:
    1. Beschreibung der Methode
    2. **@author** nickname
    3. **@version** Versionsnummer (einfach hochzählen) und Datum (z.B. @version 22 30.04.2020)
        - ab einer gewissen Stabilisierung soll jede Methode eine Versionsnummer bekommen, die bei einer Änderung um eins erhöht wird, um nachvollziehen zu können, wo besonders oft Änderungen vorgenommen werden
    4. **@param** Parametertyp Parametername Parameterbeschreibung (für alle Parameter in der Reihenfolge der Übergabe)
    5. **@throws** Exceptionname Exceptionbeschreibung
    6. **@return** Rückgabetyp Rückgabebeschreibung
- Variablendeklarationen sind möglichst in der folgenden Form zu kommentieren (Typ Name Kommentar):
    
    ```php
    /*
     * @var string $filename Zwischenspeicherung des extrahierten Dateinamens
     */
      $filename = '';
    ```
    
- Einzeilige Kommentare zum besseren Verständnis des nachfolgenden Codes sind mit einem Doppelslash einzuleiten.
- Mit einem Doppelslash eingeleitete Kommentare am Ende einer Zeile sind zu vermeiden, aber gestattet.
- Andere Kommentareinleitungen, wie z.B. **#** sind nicht gestattet.
- Mehrzeilige Kommentare sind möglichst mit // vor jeder Zeile einzuleiten, um das auskommentieren großer Blöcke zu erleichtern.
- Als Fehlerhaft bekannte Codestücke sind mit einem Kommentar der folgenden Form zu versehen:
    
    ```php
    //TODO: folgender Fehler liegt vor
    ```
    
- Als noch nicht fertig programmierte Codestücke sind mit einem Kommentar der folgenden Form zu versehen:
    
    ```php
    //TODO: folgende Funktionalität fehlt
    ```
    
- Als mit niedriger Priorität noch zu erledigende Aufgaben o.ä. sind mit einem Kommentar der folgenden Form zu versehen:
    
    ```php
    //TODO: folgendes könnte man noch machen
    ```
    

# SQL

- Alle Datenbankbefehle sind komplett in Großbuchstaben und jeder SQL-Teilbefehl (`SELECT`, `FROM`, `WHERE`, …) ist möglichst in einer eigenen Zeile zu schreiben.
- Feldnamen und Tabellennamen sind in Backticks (```) zu notieren.

Beispiel:

```sql
$sql_string = 
  'SELECT `feld1`, `feld2` FROM `tabelle`
  WHERE `feld1` = `feld2`
  ORDER BY `feld1`
  LIMIT 0,10';
```