# Sicherheitsrichtlinie

<aside>
☝ Folgende Richtlinien helfen deinen Code sicherer zu gestalten und müssen stets eingehalten werden. Bitte verinnerliche und ließ sie dir regelmäßig durch!

</aside>

1. **Unterschätze nicht die dunkle Seite der Macht**

2. **In einem serverseitigen Kontext gibt es keine clientseitige Sicherheit.**

3. **Identifiziere alle Quellen, aus denen Eingaben in die Anwendung gelangen.**
Dazu gehören auch alle HTTP-Header, Datenbankabfragen und andere Rückgaben von Sub-Systemen (Browser, Datenbank, WebServer, Shell, Elastic, und und und!). Nicht zu vergessen sind Rückgaben von APIs. Alle Daten die von außen kommen müssen identifiziert und behandelt werden.

4. **Achte auf die unsichtbare Sicherheitsbarriere: Validiere immer alle Eingaben.**
Darunter ist zu verstehen, das Daten die an den Client geschickt und erneut geholt werden, z.B. bei mehrseitigen Formularen, unbedingt als unsicher eigestuft und erneut validiert werden müssen. Eine serverseitige Speicherung solcher Daten z.B. in einer Session ist, wenn möglich, umzusetzen.

5. **Verwende clientseitige Scripte nie zu Sicherheitszwecken.**

6. **Benutze nie den Referer-Header zur Authentifizierung oder Autorisierung.**

7. **Gehe nie davon aus, dass Anfragen immer in einer bestimmten Reihenfolge ankommen.**

8. **Gebe so wenig interne Zustandsinformationen wie möglich an den Clienten weiter.**
Das heisst, speichere möglichst alle Daten serverseitig in der Session und gib nur die Session-ID an den Client. Das ist auch so versteckt wie möglich zu tun, also bleibt nur ein Cookie übrig.

9. **Verwende nie GET-Anfragen für geheime Daten, einschließlich Session-IDs.**

10. **Benutze POST-Anfragen, wenn Aktionen Änderungen durchführen.**

11. **Verwende, soweit möglich, Daten-Indirektoren für servererzeugte Eingaben.**
Es soll nie der Orginalwert übergeben werden, sondern immer ein Zeiger/eine Referenz auf den Orginalwert. Mit Datenindirektoren sind zum Beispiel Assoziative Arrays gemeint. Beispiel:
    
    ```php
    $assoziativesArray = array ( "1" => "Deutsch",
                                 "2" => "Englisch",);
     
    $language-> set('userlang',$assoziativesArray['1']);
    ```
    
12. **Gebe nie ausführliche Fehlermeldungen an den Client.**

13. **Erzeuge maschinenlesbare Logs auf Anwendungsebene.**

14. **Identifiziere jedes Zeichen, das in einem Subsystem als Metazeichen gilt.**
Metazeichen sind alle Zeichen, die das Subsystem steuern können und damit keine Daten enthalten. Das sind bei MySQL z.B. `'` oder bei HTML z.B. `<` und `>`. Nicht zu vergessen sind die `Nullbytes` bei allen Subsystemen die in C oder ähnlichen Sprachen geschrieben sind, die Nullbytes anders als Java und PHP als Stringende interpretieren 
(z.B. `resizeimage.php?img=1.gif%00;rm%20-rf;`)

15. **Behandle Metazeichen immer dann, wenn Daten an Subsysteme weitergegeben werden.**
Zum Beispiel sind HTML-Metazeichen nicht bei der Eingabe, sondern nur direkt vor der Ausgabe zu behandeln. Bei der Eingabe reicht eine Validierung auf Plausibilität der Daten, wodurch Metazeichen durchaus gefiltert werden können.

16. **Übergebe, soweit möglich, Daten getrennt von Steuerinformationen**
z.B. MySQL → prepared statements

17. **Achte auf mehrschichtige Interpretation.**
So sind z.B. beim Aufruf eines externen Programmes, wie eines Imageresizers, zum einen das Nullbyte in Dateinamen und zum anderen die Verhinderung von ungewollten Änderungen der Parameter zu beachten. Das gleiche gilt bei SQL, wo in einer LIKE-Klausel zusätzliche Metazeichen zu escapen sind (`%`). 

18. **Benutze zum Filtern Whitelisting statt Blacklisting.**

19. **Korrigiere nie eine ungültige Eingabe, um sie gültig zu machen.**
Ungültige Eingaben sind je nach Quelle verschieden zu behandeln. Eingaben aus Headern, Cookies und versteckten Feldern sind zu verwerfen und zu Protokollieren. Eine Fehlermeldung dazu soll keine Informationen geben, außer das eine Falscheingabe samt IP-Adresse protokoliert wurde. Möglicherweise versehentlich ungültige Benutzereingaben in Formularen sind mit einer entsprechenden Fehlermeldung abzuweisen und nur bei kritischen Daten, wie z.B. Passwörtern, zu protokollieren.

20. **Strebe gestaffelte Abwehr an.**
Hiermit ist gemeint, das jedes Subsystem nur so viele Rechte bekommen soll, wie unbedingt notwendig sind, so dass z.B. eine gelungene SQL-Injection so wenig wie möglich Schaden anrichten kann.

21. **Generiere immer eine neue Session-ID, wenn ein Benutzer seine Rolle ändert.**
Sessions von Benutzern, die unangemeldet waren, und sich zu einem späteren Zeitpunkt anmelden, sollen verworfen und neu angelegt werden.

22. **Erfinde keine eigenen kryptografischen Algorithmen, sondern halte dich an die existierenden.**

23. **Speichere Passwörter nie als Klartext.**
Um Passwörter sicher zu speichern, reciht kein einfaches Hashing des Passwortes, es sollte immer das Passwort in Kombination mit dem Benutzernamen und einem anwendungsspezifischen Schlüssel gehast werden.

24. **Filtere Daten vor der Einbindung in eine Webseite, ungeachtet ihres Ursprungs.**
Siehe auch Punkt 15.

25. **Vertraue nie blind einer API-Dokumentation.**

26. **Gehe immer davon aus, das der serverseitige Code für Angreifer zugänglich ist.**

27. **Sicherheit ist kein Produkt, sondern ein Prozess.**